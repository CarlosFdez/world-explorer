import { SceneUpdater } from "./scene-updater.mjs";
import { createPlainTexture, offsetToString, calculateGmPartialOpacity } from "./util.mjs";
import { WorldExplorerGridData } from "./world-explorer-grid-data.mjs";
import { MODULE } from "../index.js";

/**
 * A pair of row and column coordinates of a grid space.
 * @typedef {object} GridOffset
 * @property {number} i    The row coordinate
 * @property {number} j    The column coordinate
 */

export const DEFAULT_SETTINGS = {
    color: "#000000",
    partialColor: "",
    revealRadius: 0,
    gridRevealRadius: 0,
    opacityGM: 0.7,
    opacityPlayer: 1,
    partialOpacityPlayer: 0.3,
    persistExploredAreas: false,
    position: "behindDrawings",
};

// DEV NOTE: On sorting layers
// Elements within the primary canvas group are sorted via the following heuristics:
// 1. The object's elevation property. Drawings use their Z-Index, Tiles have a fixed value if overhead
// 2. The layer's static PRIMARY_SORT_ORDER.
// 3. The object's sort property

/** 
 * The world explorer canvas layer, which is added to the primary canvas layer.
 * The primary canvas layer is host to the background, and the actual token/drawing/tile sprites.
 * The separate token/drawing/tiles layers in the interaction layer are specifically for drawing borders and rendering the hud.
 */
export class WorldExplorerLayer extends foundry.canvas.layers.InteractionLayer {
    /**
     * Providing baseClass for proper 'name' support
     * @see InteractionLayer
     */
    static get layerOptions() {
        return {
            ...super.layerOptions,
            name: "worldExplorer",
            baseClass: WorldExplorerLayer,
        };
    }

    get sortLayer() {
        // Tokens are 700, Drawings are 600, Tiles are 500
        switch (game.settings.get(MODULE, "position")) {
            case "front":
                return 1000;
            case "behindTokens":
                return 650;
            case "behindDrawings":
                return 550;
            default:
                return 0;
        }
    }

    /** 
     * The currently set alpha value of the world explorer layer main mask
     * For players this is usually 1, but it may differ for GMs
     * @type {number};
     */
    overlayAlpha;

    /**
     * The main overlay for completely hidden tiles.
     * @type {PIXI.Sprite}
     */
    hiddenTiles;

    /**
     * The texture associated with the hiddenTiles mask
     * @type {PIXI.RenderTexture}
     */
    hiddenTilesMaskTexture;

    /** 
     * The currently set alpha value of the world explorer layer partial mask
     * For players this is different than for GMs
     * @type {number};
     */
    partialAlpha;

    /**
     * The overlay for partly revealed tiles.
     * @type {PIXI.Sprite}
     */
    partialTiles;

    /**
     * The texture associated with the partialTiles mask
     * @type {PIXI.RenderTexture}
     */
    partialTilesMaskTexture;

    constructor() {
        super();
        this.color = DEFAULT_SETTINGS.color;
        this.partialColor = this.color;

        /** @type {Partial<WorldExplorerState>} */
        this.state = {};
    }

    /** Any settings we are currently previewing. Currently unused, will be used once we're more familiar with the scene config preview */
    previewSettings = {};

    /** @returns {WorldExplorerFlags} */
    get settings() {
        const settings = this.scene.flags[MODULE] ?? {};
        return { ...DEFAULT_SETTINGS, ...settings, ...this.previewSettings };
    }

    get elevation() {
        return game.settings.get(MODULE, "position") === "front" ? Infinity : 0;
    }

    /**
     * Get a GridHighlight layer for this Ruler
     * @type {GridHighlight}
     */
    get highlightLayer() {
        return canvas.interface.grid.highlightLayers[this.name] || canvas.interface.grid.addHighlightLayer(this.name);
    }

    /** @type {WorldExplorerGridData} */
    get gridDataMap() {
        this._gridDataMap ??= new WorldExplorerGridData(this.scene.getFlag(MODULE, "gridData") ?? {});
        return this._gridDataMap;
    }

    get enabled() {
        return !!this._enabled;
    }

    set enabled(value) {
        this._enabled = !!value;
        this.visible = !!value;

        if (value) {
            this.refreshOverlay();
            this.refreshMask();
        } else {
            this.removeChildren();
        }
    }

    /** Returns true if the user is currently editing, false otherwise. */
    get editing() {
        return this.enabled && this.state.clearing;
    }

    /** Returns true if there is no image or the GM is viewing and partial color is set */
    get showPartialTiles() {
        return !this.image || (this.settings.partialColor && game.user.isGM);
    }

    initialize() {
        const { x, y, width, height } = canvas.dimensions.sceneRect;

        // Sprite to cover the hidden tiles. Fill with white texture, or image texture if one is set
        this.hiddenTiles = new PIXI.Sprite(PIXI.Texture.WHITE);
        this.hiddenTiles.position.set(x, y);
        this.hiddenTiles.width = width;
        this.hiddenTiles.height = height;

        // Create a mask for it, with a texture we can reference later to update the mask
        this.hiddenTilesMaskTexture = createPlainTexture();
        this.hiddenTiles.mask = new PIXI.Sprite(this.hiddenTilesMaskTexture);
        this.hiddenTiles.mask.position.set(x, y);

        // Add to the layer
        this.addChild(this.hiddenTiles);
        this.addChild(this.hiddenTiles.mask);

        // Graphic to cover the partially revealed tiles (doesn't need an image texture, so use Graphics)
        // Needs to be separate, for we want it to have a different color
        this.partialTiles = new PIXI.Graphics();

        // Create a separate mask for it, as it will also have separate transparency so it can overlay the image texture
        this.partialTilesMaskTexture = createPlainTexture();
        this.partialTiles.mask = new PIXI.Sprite(this.partialTilesMaskTexture);
        this.partialTiles.mask.position.set(x, y);

        // Add to the layer
        this.addChild(this.partialTiles);
        this.addChild(this.partialTiles.mask);

        this.#syncSettings();
        this.#migratePositions();
    }

    async _draw() {
        const scene = canvas.scene;
        this.scene = scene;
        this.updater = new SceneUpdater(scene);

        this.state = {};
        this.initialize();
        this.refreshOverlay();
        this.refreshImage();

        return this;
    }

    /** Triggered when the current scene updates */
    update() {
        if (this.#migratePositions()) {
            return;
        }

        const flags = this.settings;
        const imageChanged = this.image !== flags.image;
        const becameEnabled = !this.enabled && flags.enabled;

        this.#syncSettings();
        this.refreshMask();

        if (becameEnabled) {
            this.refreshOverlay();
        } else {
            this.refreshColors();
        }
        if (imageChanged || !flags.enabled || becameEnabled) {
            this.refreshImage();
        }
    }

    /** Reads flags and updates variables to match */
    #syncSettings() {
        const flags = this.settings;
        this._enabled = flags.enabled;
        this.visible = this._enabled;
        this.color = flags.color;
        this.partialColor = flags.partialColor || this.color;
        this.image = flags.image;
        this._gridDataMap = new WorldExplorerGridData(this.scene.getFlag(MODULE, "gridData") ?? {});
        this.#syncAlphas();
    }

    /** 
     * Reads alpha flags and update variables to match.
     * Do this separately, so it can be invoked on a mask-only update
     * As only the mask uses the alpha
     */
    #syncAlphas() {
        const flags = this.settings;
        this.overlayAlpha = (game.user.isGM ? flags.opacityGM : flags.opacityPlayer) ?? DEFAULT_SETTINGS.opacityPlayer;
        this.partialAlpha = flags.partialOpacityPlayer ?? DEFAULT_SETTINGS.partialOpacityPlayer;

        // If the user is a GM, compute the partial opacity based on the other opacities
        if (game.user.isGM && flags.opacityPlayer) {
            const opacityPlayer = flags.opacityPlayer ?? DEFAULT_SETTINGS.opacityPlayer;
            const opacityGM = this.overlayAlpha;
            const opacityPartial = this.partialAlpha;
            this.partialAlpha = calculateGmPartialOpacity({ opacityPlayer, opacityGM, opacityPartial });
        }
    }

    onChangeTool(toolName) {
        const isEditTool = ["toggle", "reveal", "partial", "hide"].includes(toolName);
        if (this.active && isEditTool) {
            canvas.worldExplorer.startEditing(toolName);
        } else {
            canvas.worldExplorer.stopEditing();
        }
    }

    /** @param {EditingMode} mode */
    startEditing(mode) {
        this.state.clearing = true;
        this.state.tool = mode;
        if (this.enabled) {
            this.highlightLayer.clear();
        }
    }

    stopEditing() {
        this.state.clearing = false;
        if (this.enabled) {
            this.highlightLayer.clear();
        }
    }

    refreshImage(image = null) {
        this.image ??= image;
        if (this.enabled && this.image) {
            foundry.canvas.loadTexture(this.image).then((texture) => {
                this.hiddenTiles.texture = texture;
            });
        } else {
            this.hiddenTiles.texture = this.enabled ? PIXI.Texture.WHITE : null;
        }
    }

    refreshOverlay() {
        if (!this.enabled) return;

        // Hide the partial tiles if an image is present and this is not the GM
        this.partialTiles.visible = this.showPartialTiles;
        // Fill the partialTiles, if visible, with something to mask
        if (this.partialTiles.visible) {
            const { x, y, width, height } = canvas.dimensions.sceneRect;
            this.partialTiles.beginFill(0xFFFFFF);
            this.partialTiles.drawRect(x, y, width, height);
            this.partialTiles.endFill();
        }

        this.refreshColors();
    }

    refreshColors() {
        if (!this.enabled) return;

        // Set the color of the overlay, but only if no image is present
        this.hiddenTiles.tint = !this.image ? Color.from(this.color) : 0xFFFFFF;
        // Set the color of the partial tiles
        this.partialTiles.tint = Color.from(this.partialColor);
    }

    /**
     * Create masks for the main (maskGraphic) and partial (partialMask) layers
     * The maskGraphic must be everything except the revealed and partial tiles
     * The partialMask must be only the partial tiles
     */
    refreshMask() {
        if (!this.enabled) return;
        this.#syncAlphas();
        const { x, y, width, height } = canvas.dimensions.sceneRect;

        // Create the mask graphics, although partialMask may be null if not enabled
        const maskGraphic = new PIXI.Graphics();
        maskGraphic.position.set(-x, -y);
        const partialMask = this.showPartialTiles ? new PIXI.Graphics() : null;
        partialMask?.position.set(-x, -y);

        // Cover everything with the main mask by painting it white
        maskGraphic.beginFill(0xFFFFFF, this.overlayAlpha);
        maskGraphic.drawRect(x, y, width, height);
        maskGraphic.endFill();

        // Process the partial tiles. Uncover them in the main mask, but cover them in the partial mask
        //
        // Unless this is an image, then we need to:
        // - Cover the tile on the main mask again, but with partial alpha
        // - Use 0.5 alpha on the partial mask to slightly color the partial
        // - reveal parts of the image for the GM
        maskGraphic.beginFill(0x000000);
        partialMask?.beginFill(0xFFFFFF, !this.image ? this.partialAlpha : 0.5);
        // We are not drawing gridRevealRadius for partials, as that will result in overlapping transparant circles, which looks terrible
        for (const entry of this.gridDataMap.partials) {
            const poly = this._getGridPolygon(entry.offset);
            maskGraphic.drawPolygon(poly);
            partialMask?.drawPolygon(poly);
            // If this is an image, we need to set the tile to the partial opacity, thus we have to draw a new white polygon where we just made a black one
            if (this.image) {
                maskGraphic.beginFill(0xFFFFFF, this.partialAlpha);
                maskGraphic.drawPolygon(poly);
                // Back to a black fill for the next one
                maskGraphic.beginFill(0x000000);
            }
        }

        // Process the revealed tiles, uncover them in the main mask
        // Also uncover reveal radius, if enabled, in both.
        // This needs to happen after the partial tiles
        const gridRevealRadius = this.getGridRevealRadius();
        partialMask?.beginFill(0x000000);
        for (const entry of this.gridDataMap.revealed) {
            // Uncover circles if extend grid elements is set
            if (gridRevealRadius > 0) {
                const { x, y } = canvas.grid.getCenterPoint(entry.offset);
                maskGraphic.drawCircle(x, y, gridRevealRadius);
                partialMask?.drawCircle(x, y, gridRevealRadius);
            } else {
                // Otherwise just uncover the revealed grid
                const poly = this._getGridPolygon(entry.offset);
                maskGraphic.drawPolygon(poly);
            }
        }

        // Uncover observer tokens, if set
        const tokenRevealRadius = Math.max(Number(this.scene.getFlag(MODULE, "revealRadius")) || 0, 0);
        if (tokenRevealRadius > 0) {
            for (const token of canvas.tokens.placeables) {
                const document = token.document;
                if (document.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY || document.hasPlayerOwner) {
                    const { x, y } = token.center;
                    maskGraphic.drawCircle(x, y, token.getLightRadius(tokenRevealRadius));
                    partialMask?.drawCircle(x, y, token.getLightRadius(tokenRevealRadius));
                }
            }
        }

        maskGraphic.endFill();
        partialMask?.endFill();

        // Render the masks. Only render the partial mask if applicable
        canvas.app.renderer.render(maskGraphic, { renderTexture: this.hiddenTilesMaskTexture });
        maskGraphic.destroy();
        if (this.showPartialTiles && partialMask) {
            canvas.app.renderer.render(partialMask, { renderTexture: this.partialTilesMaskTexture });
            partialMask.destroy();
        }
    }

    /** Returns the grid reveal distance in canvas coordinates (if configured) */
    getGridRevealRadius() {
        const gridRadius = Math.max(Number(game.settings.get(MODULE, "gridRevealRadius")) || 0, DEFAULT_SETTINGS.gridRevealRadius);
        if (!(gridRadius > 0)) return 0;

        // Convert from units to pixel radius, stolen from token.getLightRadius()
        const u = Math.abs(gridRadius);
        const hw = (canvas.grid.sizeX / 2);
        return (((u / canvas.dimensions.distance) * canvas.dimensions.size) + hw) * Math.sign(gridRadius);
    }

    /**
     * Returns true if a grid coordinate (x, y) or offset (i, j) is revealed.
     * @param {Point} position
     */
    isRevealed({coords = null, offset = null}) {
        if (!coords && !offset) return null;
        return this.gridDataMap.get({ coords, offset })?.reveal === true;
    }

    /**
     * Returns true if a grid coordinate (x, y) or offset (i, j) is partly revealed.
     * @param {Point} position
     */
    isPartial({coords = null, offset = null}) {
        if (!coords && !offset) return null;
        return this.gridDataMap.get({ coords, offset })?.reveal === "partial";
    }

    /** 
     * Reveals a coordinate or offset and saves it to the scene
     * @param {Point} position
     */
    reveal({coords = null, offset = null}) {
        if (!this.enabled || (!coords && !offset)) return;
        this.updater.reveal({coords, offset});
    }

    /** 
     * Partly reveals a coordinate or offset and saves it to the scene
     * @param {Point} position
     */
    partial({coords = null, offset = null}) {
        if (!this.enabled || (!coords && !offset)) return;
        this.updater.partial({coords, offset});
    }

    /** 
     * Unreveals a coordinate or offset and saves it to the scene
     * @param {Point} position
     */
    unreveal({coords = null, offset = null}) {
        if (!this.enabled || (!coords && !offset)) return;
        this.updater.hide({coords, offset});
    }

    /** Clears the entire scene. If reveal: true is passed, reveals all positions instead */
    clear(options) {
        this.updater.clear(options);
    }

    onCanvasReady() {
        this.refreshMask();
        this.registerMouseListeners();
        // enable the currently select tool if its one of World Explorer's
        if (this.active) this.onChangeTool(game.activeTool);
    }

    registerMouseListeners() {
        // We need to make sure that pointer events are only valid if they started on the canvas
        // If null, dragging is not ongoing. If false, all events should be blocked. If true, we started dragging from the canvas
        let draggingOnCanvas = null;

        /** Returns true if the element is the board, aka the main canvas */
        const canEditLayer = (event) => {
            const element = event.srcElement;
            const isMainCanvas = element && element.tagName === "CANVAS" && element.id === "board";
            return draggingOnCanvas !== false && this.enabled && this.editing && (draggingOnCanvas || isMainCanvas);
        };

        // Renders the highlight to use for the grid's future status
        const renderHighlight = (position, revealed, partial) => {
            const { x, y } = canvas.grid.getTopLeftPoint(position);
            this.highlightLayer.clear();

            // In certain modes, we only go one way, check if the operation is valid
            const canReveal = !revealed && ["toggle", "reveal"].includes(this.state.tool);
            const canHide = (revealed && ["toggle", "hide"].includes(this.state.tool)) || (partial && this.state.tool === "hide");
            const canPartial = !partial && this.state.tool === "partial";

            if (canReveal || canHide || canPartial) {
                // blue color for revealing tiles
                let color = 0x0022FF;
                if (canPartial) {
                    // default to purple for making tiles partly revealed if no partial
                    // color is defined, otherwise it would look identical to the hide tool
                    color = this.settings.partialColor ? Color.from(this.partialColor) : 0x7700FF;
                } else if (canHide) {
                    color = Color.from(this.color);
                }
                canvas.interface.grid.highlightPosition(this.highlightLayer.name, { x, y, color, border: color });
            }
        };

        canvas.stage.addListener('pointerup', () => {
            draggingOnCanvas = null; // clear dragging status when mouse is lifted
        });

        canvas.stage.addListener('pointerdown', (event) => {
            if (!canEditLayer(event)) {
                draggingOnCanvas = false;
                return;
            }
            draggingOnCanvas = true;

            if (event.data.button !== 0) return;

            const coords = event.data.getLocalPosition(canvas.app.stage);
            const offset = canvas.grid.getOffset(coords);
            const revealed = this.isRevealed({coords, offset});
            const partial = this.isPartial({coords, offset});

            // In certain modes, we only go one way, check if the operation is valid
            const canReveal = !revealed && ["toggle", "reveal"].includes(this.state.tool);
            const canHide = (revealed && ["toggle", "hide"].includes(this.state.tool)) || (partial && this.state.tool === "hide");
            const canPartial = !partial && this.state.tool === "partial";

            if (canHide) {
                this.unreveal({coords, offset});
            } else if (canReveal) {
                this.reveal({coords, offset});
            } else if (canPartial) {
                this.partial({coords, offset});
            } else {
                return;
            }

            renderHighlight(coords, revealed, partial);
        });

        canvas.stage.addListener('pointermove', (event) => {
            // If no button is held down, clear the dragging status
            if (event.data.buttons !== 1) {
                draggingOnCanvas = null;
            }

            if (!canEditLayer(event)) {
                // If we can't edit the layer *and* a button is held down, flag as a non-canvas drag
                if (event.data.buttons === 1) {
                    draggingOnCanvas = false;
                }
                this.highlightLayer.clear();
                return;
            }

            // Get mouse position translated to canvas coords
            const coords = event.data.getLocalPosition(canvas.app.stage);
            const offset = canvas.grid.getOffset(coords);
            const revealed = this.isRevealed({coords, offset});
            const partial = this.isPartial({coords, offset});
            renderHighlight(coords, revealed, partial);

            // For brush or eraser modes, allow click drag drawing
            if (event.data.buttons === 1 && this.state.tool !== "toggle") {
                draggingOnCanvas = true;
                if ((revealed || partial) && this.state.tool === "hide") {
                    this.unreveal({coords, offset});
                } else if (!revealed && this.state.tool === "reveal") {
                    this.reveal({coords, offset});
                } else if (!partial && this.state.tool === "partial") {
                    this.partial({coords, offset});
                }
            }
        });
    }

    /**
     * Gets the grid polygon from a grid position (row and column).
     * @param {GridOffset} offset
     */
    _getGridPolygon(offset) {
        // todo: check if this has issues with gaps again. If so, bring back expandPolygon
        return new PIXI.Polygon(canvas.grid.getVertices(offset));
    }

    /** 
     * Migrate from older flags to newer flag data
     * @returns {boolean} true if changes have been made
     */
    #migratePositions() {
        // Get the flags and see if any of the old flags are present
        const flags = this.settings;

        // Check if need to update flag version
        const moduleVersion = foundry.packages.Module.get(MODULE).version;
        const flagsVersion = flags.flagsVersion ?? 0;
        if ( !foundry.utils.isNewerVersion(moduleVersion, flagsVersion) ) return false; // nothing to update

        const updateFlags = {
            "flags.world-explorer.flagsVersion": moduleVersion
        };

        // Check if migration is needed
        if (foundry.utils.isNewerVersion('2.1.0', flagsVersion)) {
            // Check if we need to migrate the grid data flag
            const oldFlags = ["revealed", "revealedPositions", "gridPositions"];
            const hasOldFlag = oldFlags.find((flag) => flag in flags);
            if (hasOldFlag) {
                // Get info about grid position that are in the padding, so they aren't migrated
                const { x, y, width, height } = canvas.dimensions.sceneRect;
                // First grid square/hex that is on the map (sceneRect)
                const startOffset = canvas.grid.getOffset({ x: x + 1, y: y + 1 });
                // Last grid square/hex that is on the map (sceneRect)
                const endOffset = canvas.grid.getOffset({ x: x + width - 1, y: y + height - 1 });

                const newFlagData = flags[hasOldFlag].reduce((newFlag, position) => {
                    let i, j, reveal;
                    switch (hasOldFlag) {
                        case "revealed":
                            [i, j] = canvas.grid.getGridPositionFromPixels(...position);
                            reveal = true;
                            break;
                        case "revealedPositions":
                            [i, j] = position;
                            reveal = true;
                            break;
                        case "gridPositions":
                            [i, j, reveal] = position;
                            reveal = reveal === "reveal" ? true : "partial";
                            break;
                    }
                    // Only add it if this offset is on the map and not in the padding
                    if (i >= startOffset.i && j >= startOffset.j && i <= endOffset.i && j <= endOffset.j) {
                        const offset = { i, j };
                        const key = offsetToString(offset);
                        newFlag[key] = { offset, reveal };
                    }
                    return newFlag;
                }, {});

                updateFlags["flags.world-explorer.gridData"] = newFlagData;
                for (const flag of oldFlags) {
                    updateFlags[`flags.world-explorer.-=${flag}`] = null;
                }
                ui.notifications.info(game.i18n.localize("WorldExplorer.Notifications.Migrated"));
            }
        }

        // Set current version to the flags and process added migrations
        if (Object.keys(updateFlags).length) {
            this.scene.update(updateFlags);
            return true;
        }

        return false;
    }
}