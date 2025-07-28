import { SceneUpdater } from "./scene-updater.mjs";

const MODULE = "world-explorer";

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
    partialOpacityGM: 0.3,
    partialOpacityPlayer: 0.3,
    persistExploredAreas: false,
    position: "behindDrawings",
};

// DEV NOTE: On sorting layers
// Elements within the primary canvas group are sorted via the following heuristics:
// 1. The object's elevation property. Drawings use their Z-index, Tiles have a fixed value if overhead
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
        switch (this.settings.position) {
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

    constructor() {
        super();
        this.color = DEFAULT_SETTINGS.color;
        this.partialColor = this.color;

        /** @type {Partial<WorldExplorerState>} */
        this.state = {};
    }

    /** Any settings we are currently previewing. Currently unused, will be used once we're not familiar with the scene config preview */ 
    previewSettings = {};

    /** @returns {WorldExplorerFlags} */
    get settings() {
        const settings = this.scene.flags[MODULE] ?? {};
        return { ...DEFAULT_SETTINGS, ...settings, ...this.previewSettings };
    }

    get elevation() {
        return this.settings.position === "front" ? Infinity : 0;
    }

    /**
     * Get a GridHighlight layer for this Ruler
     * @type {GridHighlight}
     */
    get highlightLayer() {
        return canvas.interface.grid.highlightLayers[this.name] || canvas.interface.grid.addHighlightLayer(this.name);
    }

    /** @type {GridOffset[]} */
    get revealed() {
        // return (this.scene.getFlag(MODULE, "revealedPositions") ?? []).map(([i, j]) => ({ i, j }));
        return (this.scene.getFlag(MODULE, "gridPositions") ?? []).map(([i, j, state]) => (state === "reveal" ? { i, j } : false)).filter(n => n);
    }

    /** @type {GridOffset[]} */
    get partials() {
        return (this.scene.getFlag(MODULE, "gridPositions") ?? []).map(([i, j, state]) => (state === "partial" ? { i, j } : false)).filter(n => n);
    }

    get enabled() {
        return !!this._enabled;
    }

    set enabled(value) {
        this._enabled = !!value;
        this.visible = !!value;
        
        if (value) {
            this.refreshOverlays();
            this.refreshMasks();
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
        return !this.image || (this.partialColor && game.user.isGM);
    }

    initialize(options) {
        const { sceneRect } = canvas.dimensions;
        // Sprite to cover the hidden tiles. Fill with white texture, or image texture if one is set
        this.hiddenTiles = new PIXI.Sprite(PIXI.Texture.WHITE);
        this.hiddenTiles.position.set(sceneRect.x, sceneRect.y);
        this.hiddenTiles.width = sceneRect.width;
        this.hiddenTiles.height = sceneRect.height;
        // Create a mask for it, with a texture we can reference later to update the mask
        this.hiddenTilesMaskTexture = this._getPlainTexture();
        this.hiddenTiles.mask = new PIXI.Sprite(this.hiddenTilesMaskTexture);
        this.hiddenTiles.mask.position.set(sceneRect.x, sceneRect.y);
        // Add to the layer
        this.addChild(this.hiddenTiles);
        this.addChild(this.hiddenTiles.mask);

        // Graphic to cover the partially revealed tiles (doesn't need an image texture, so use sprite)
        // Needs to be separate, for we want it to have a different colour
        this.partialTiles = new PIXI.Graphics();
        // Create a separate mask for it, as it will also have separate transparency so it can overlay the image texture
        this.partialTilesMaskTexture = this._getPlainTexture();
        this.partialTiles.mask = new PIXI.Sprite(this.partialTilesMaskTexture);
        this.partialTiles.mask.position.set(sceneRect.x, sceneRect.y);
        // Add to the layer
        this.addChild(this.partialTiles);
        this.addChild(this.partialTiles.mask);

        this.updateSettings();
    }

    async _draw() {
        const scene = canvas.scene;
        this.scene = scene;
        this.updater = new SceneUpdater(scene);

        this.state = {};
        this.initialize();
        this.refreshOverlays();
        this.refreshImage();

        return this;
    }

    /** Triggered when the current scene update */
    update() {
        if (this.#migratePositions()) {
            return;
        }

        const flags = this.settings;
        const imageChanged = this.image !== flags.image;
        const becameEnabled = !this.enabled && flags.enabled;

        this.updateSettings();

        if (becameEnabled || imageChanged) {
            this.refreshOverlays();
        } else {
            this.refreshColors();
        }
        this.refreshMasks();
        if (imageChanged || !flags.enabled || becameEnabled) {
            this.refreshImage();
        }
    }

    /** Set the settings to `this` on initialize and updates. */
    updateSettings() {
        const flags = this.settings;
        this.hiddenAlpha = (game.user.isGM ? flags.opacityGM : flags.opacityPlayer) ?? DEFAULT_SETTINGS.opacityPlayer;
        this.partialAlpha = (game.user.isGM ? flags.partialOpacityGM : flags.partialOpacityPlayer) ?? DEFAULT_SETTINGS.partialOpacityPlayer;
        this.color = flags.color;
        this.partialColor = flags.partialColor;
        this.image = flags.image;
        this._enabled = flags.enabled;
        this.visible = this._enabled;
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
        if (image) this.image = image;
        if (this.enabled && this.image) {
            foundry.canvas.loadTexture(this.image).then((texture) => {
                this.hiddenTiles.texture = texture;
            });
        } else {
            this.hiddenTiles.texture = this.enabled ? PIXI.Texture.WHITE : null;
        }
    }

    refreshOverlays() {
        if (!this.enabled) return;

        // Fill the partialTiles, always for the GM, even if there is an image
        if (this.showPartialTiles) {
            this.partialTiles.beginFill(0xFFFFFF);
            this.partialTiles.drawRect(0, 0, canvas.dimensions.width, canvas.dimensions.height);
            this.partialTiles.endFill();
        }
        this.refreshColors();
    }

    refreshColors() {
        if (!this.enabled || (this.hiddenAlpha === 0 && this.partialAlpha === 0)) return;

        // Set the color of the layers, but only if no image is present
        if (!this.image) {
            this.hiddenTiles.tint = Color.from(this.color ?? DEFAULT_SETTINGS.color);
            this.partialTiles.tint = Color.from(this.partialColor) ?? this.hiddenOverlay.tint;
            this.partialTiles.alpha = 1;
        } else if (this.showPartialTiles) {
            // Do set the partial tile color for the GM even if an image is present
            this.hiddenTiles.tint = 0xFFFFFF;
            this.partialTiles.tint = Color.from(this.partialColor);
            this.partialTiles.alpha = 1;
        } else {
            // Reset the color if an image is present, otherwise it gets colored
            this.hiddenTiles.tint = 0xFFFFFF;
            // Make the partial tiles layer hidden
            this.partialTiles.tint = 0xFFFFFF;
            this.partialTiles.alpha = 0;
        }
    }

    refreshMasks() {
        if (!this.enabled) return;
        const { width, height, sceneRect } = canvas.dimensions;

        /** Create masks for the hidden and partial layers
         * The hidden mask must be everything except the revealed and partial tiles
         * The partial mask must be only the partial tiles
         * Make an empty object partial mask if we are not going to use it
         */
        const hiddenMask = new PIXI.Graphics();
        const partialMask = this.showPartialTiles ? new PIXI.Graphics() : {};
        hiddenMask.position.set(-sceneRect.x, -sceneRect.y);
        partialMask.position?.set(-sceneRect.x, -sceneRect.y);

        // Cover everything with the main mask
        hiddenMask.beginFill(0xFFFFFF, this.hiddenAlpha);
        hiddenMask.drawRect(0, 0, width, height);
        hiddenMask.endFill();

        /** Do the partial tiles
         * Uncover them in the main mask, but cover them in the partial mask
         * 
         * Unless this is an image, then we need to:
         * - Cover the tile on the main mask again, but with partial alpha
         * - Use 0.5 alpha on the partial mask to slightly color the partial
         *   revealed parts of the image for the GM
        */
        hiddenMask.beginFill(0x000000);
        partialMask.beginFill?.(0xFFFFFF, !this.image ? this.partialAlpha : 0.5);
        // We are not drawing gridRevealRadius for partials, as that will result in overlapping transparant circles, which looks terrible
        for (const position of this.partials) {
            const poly = this._getGridPolygon(position);
            hiddenMask.drawPolygon(poly);
            partialMask.drawPolygon?.(poly);
            // If this is an image, we need to set the main mask to the right opacity for the partial tiles
            if (this.image) {
                hiddenMask.beginFill(0xFFFFFF, this.partialAlpha);
                hiddenMask.drawPolygon(poly);
                // Back to a black fill for the next one
                hiddenMask.beginFill(0x000000);
            }
        }

        // Do the revealed tiles, uncover them in the main mask
        // Also uncover reveal radius, if enabled, in both. This needs to happen after the partial tiles
        const gridRevealRadius = this.getGridRevealRadius();
        partialMask.beginFill?.(0x000000);
        for (const position of this.revealed) {
            // Uncover circles if extend grid elements is set
            if (gridRevealRadius > 0) {
                const { x, y } = canvas.grid.getCenterPoint(position);
                hiddenMask.drawCircle(x, y, gridRevealRadius);
                partialMask.drawCircle?.(x, y, gridRevealRadius);
            } else {
                // Otherwise just uncover the revealed grid
                const poly = this._getGridPolygon(position);
                hiddenMask.drawPolygon(poly);
            }
        }

        // Uncover observer tokens from both masks, if set
        const tokenRevealRadius = Math.max(Number(this.scene.getFlag(MODULE, "revealRadius")) || 0, 0);
        if (tokenRevealRadius > 0) {
            for (const token of canvas.tokens.placeables) {
                const document = token.document;
                if (document.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY || document.hasPlayerOwner) {
                    const x = token.center.x;
                    const y = token.center.y;
                    hiddenMask.drawCircle(x, y, token.getLightRadius(tokenRevealRadius));
                    partialMask.drawCircle?.(x, y, token.getLightRadius(tokenRevealRadius));
                }
            }
        }

        hiddenMask.endFill();
        partialMask.endFill?.();

        // Render the masks
        canvas.app.renderer.render(hiddenMask, { renderTexture: this.hiddenTilesMaskTexture });
        hiddenMask.destroy();
        // Only render the partial mask if applicable
        if (this.showPartialTiles) {
            canvas.app.renderer.render(partialMask, { renderTexture: this.partialTilesMaskTexture });
            partialMask.destroy();
        }
    }

    /** Returns the grid reveal distance in canvas coordinates (if configured) */
    getGridRevealRadius() {
        const gridRadius = Math.max(Number(this.scene.getFlag(MODULE, "gridRevealRadius")) || 0, 0);
        if (!(gridRadius > 0)) return 0;

        // Convert from units to pixel radius, stolen from token.getLightRadius()
        const u = Math.abs(gridRadius);
        const hw = (canvas.grid.sizeX / 2);
        return (((u / canvas.dimensions.distance) * canvas.dimensions.size) + hw) * Math.sign(gridRadius);
    }

    /**
     * Returns true if a grid coordinate (x, y) is revealed.
     * @param {Point} position
     */
    isRevealed(position) {
        return this._getRevealedIndex(position.x, position.y) > -1;
    }

    /**
     * Returns true if a grid coordinate (x, y) is partly revealed.
     * @param {Point} position
     */
    isPartial(position) {
        return this._getPartialIndex(position.x, position.y) > -1;
    }

    /** 
     * Reveals a coordinate and saves it to the scene
     * @param {Point} position
     */
    reveal(position) {
        if (!this.enabled) return;
        this.updater.reveal(position.x, position.y);
    }

    /** 
     * Partial a coordinate and saves it to the scene
     * @param {Point} position
     */
    partial(position) {
        if (!this.enabled) return;
        this.updater.partial(position.x, position.y);
    }

    /** 
     * Unreveals a coordinate and saves it to the scene 
     * @param {Point} position
     */
    unreveal(position) {
        if (!this.enabled) return;
        this.updater.hide(position.x, position.y);
    }

    /** Clears the entire scene. If reveal: true is passed, reveals all positions instead */
    clear(options) {
        this.updater.clear(options);
    }

    onCanvasReady() {
        this.refreshMasks();
        this.registerMouseListeners();
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
        const renderHighlight = (position, reveal) => {
            const { x, y } = canvas.grid.getTopLeftPoint(position);
            this.highlightLayer.clear();
            
            // In certain modes, we only go one way, check if the operation is valid
            const canReveal = ["toggle", "reveal"].includes(this.state.tool);
            const canHide = ["toggle", "hide"].includes(this.state.tool);
            if ((reveal && canReveal) || (!reveal && canHide)) {
                const color = reveal ? 0x0022FF : 0xFF0000;
                canvas.interface.grid.highlightPosition(this.highlightLayer.name, { x, y, color, border: 0xFF0000 });
            }
        };

        canvas.stage.addListener('pointerup', (event) => {
            draggingOnCanvas = null; // clear dragging status when mouse is lifted
        });

        canvas.stage.addListener('pointerdown', (event) => {
            if (!canEditLayer(event)) {
                draggingOnCanvas = false;
                return;
            }

            draggingOnCanvas = true;
            const canReveal = ["toggle", "reveal"].includes(this.state.tool);
            const canHide = ["toggle", "hide"].includes(this.state.tool);
            
            if (event.data.button === 0) {
                const coords = event.data.getLocalPosition(canvas.app.stage);
                const revealed = this.isRevealed(coords);
                if (revealed && canHide) {
                    this.unreveal(coords);
                } else if (!revealed && canReveal) {
                    this.reveal(coords)
                } else {
                    return;
                }

                renderHighlight(coords, revealed);
            }
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
            const revealed = this.isRevealed(coords)
            renderHighlight(coords, !revealed);

            // For brush or eraser modes, allow click drag drawing
            if (event.data.buttons === 1 && this.state.tool !== "toggle") {
                draggingOnCanvas = true;
                const coords = event.data.getLocalPosition(canvas.app.stage);
                const revealed = this.isRevealed(coords);
                if (revealed && this.state.tool == "hide") {
                    this.unreveal(coords);
                } else if (!revealed && this.state.tool === "reveal") {
                    this.reveal(coords);
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

    /** @param {PointArray} point */
    _getRevealedIndex(...point) {
        const { i, j } = canvas.grid.getOffset({ x: point[0], y: point[1] });
        return this.revealed.findIndex((r) => r.i === i && r.j === j);
    }

    /** @param {PointArray} point */
    _getPartialIndex(...point) {
        const { i, j } = canvas.grid.getOffset({ x: point[0], y: point[1] });
        return this.partials.findIndex((r) => r.i === i && r.j === j);
    }

    /**
     * Gets a simple PIXI texture sized to the canvas
     */
    _getPlainTexture() {
        const { sceneRect } = canvas.dimensions;
        return PIXI.RenderTexture.create({
            width: sceneRect.width,
            height: sceneRect.height,
        });
    }

    /** Attempt to migrate from older positions (absolute coords) to newer positions (row/col). */
    #migratePositions() {
        const flags = this.settings;
        const revealedFlag = "revealed" in flags;
        const revealedPositionsFlag = "revealedPositions" in flags;
        if (revealedFlag || revealedPositionsFlag) {
            let newRevealed = [];
            if (revealedFlag) {
                newRevealed = flags.revealed.map((position) => canvas.grid.getGridPositionFromPixels(...position).concat("reveal"));
            } else if (revealedPositionsFlag) {
                newRevealed = flags.revealedPositions.map((position) => position.concat("reveal"));
            }
            canvas.scene.flags["world-explorer"].revealed = null;
            canvas.scene.flags["world-explorer"].revealedPositions = null;
            this.scene.update({
                "flags.world-explorer.gridPositions": newRevealed,
                "flags.world-explorer.-=revealedPositions": null,
                "flags.world-explorer.-=revealed": null
            });
            ui.notifications.info(game.i18n.localize("WorldExplorer.Notifications.Migrated"));
            return true;
        }

        return false;
    }
}