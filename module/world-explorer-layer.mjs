import { SceneUpdater } from "./scene-updater.mjs";
import { createPlainTexture } from "./util.mjs";

const MODULE = "world-explorer";

/**
 * A pair of row and column coordinates of a grid space.
 * @typedef {object} GridOffset
 * @property {number} i    The row coordinate
 * @property {number} j    The column coordinate
 */

export const DEFAULT_SETTINGS = {
    color: "#000000",
    revealRadius: 0,
    gridRevealRadius: 0,
    opacityGM: 0.7,
    opacityPlayer: 1,
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
        return (this.scene.getFlag(MODULE, "revealedPositions") ?? []).map(([i, j]) => ({ i, j }));
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
            this.removeChildren()
        }
    }

    /** Returns true if the user is currently editing, false otherwise. */
    get editing() {
        return this.enabled && this.state.clearing;
    }

    initialize(options) {
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

        this.updateSettings();

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

    /** Triggered when the current scene update */
    update() {
        if (this.#migratePositions()) {
            return;
        }

        const flags = this.settings;
        const imageChanged = this.image !== flags.image;
        const becameEnabled = !this.enabled && flags.enabled;

        this.updateSettings();

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

    /** Set the settings to `this` on initialize and updates. */
    updateSettings() {
        const flags = this.settings;
        this.hiddenAlpha = (game.user.isGM ? flags.opacityGM : flags.opacityPlayer) ?? DEFAULT_SETTINGS.opacityPlayer;
        this.color = flags.color;
        this.image = flags.image;
        this._enabled = flags.enabled;
        this.visible = this._enabled;
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
        if (image) this.image = image;
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

        // Keep this process for now, needed when adding partial tiles

        this.refreshColors();
    }

    refreshColors() {
        if (!this.enabled || this.hiddenAlpha === 0) return;

        // Set the color of the layers, but only if no image is present
        if (!this.image) {
            this.hiddenTiles.tint = Color.from(this.color);
        } else {
            // Reset the color if an image is present, otherwise it gets colored
            this.hiddenTiles.tint = 0xFFFFFF;
        }
    }

    refreshMask() {
        if (!this.enabled) return;
        const { x, y, width, height } = canvas.dimensions.sceneRect;

        // Create mask for the hiddenTiles / image layer
        const hiddenMask = new PIXI.Graphics();
        hiddenMask.position.set(-x, -y);

        // Cover everything with the mask by painting it white
        hiddenMask.beginFill(0xFFFFFF, this.hiddenAlpha);
        hiddenMask.drawRect(x, y, width, height);
        hiddenMask.endFill();

        // Now uncover the revealed tiles by painting them black in the mask
        hiddenMask.beginFill(0x000000);

        // Do the revealed tiles, uncover them or the reveal radius in the main mask
        const gridRevealRadius = this.getGridRevealRadius();
        for (const position of this.revealed) {
            // Uncover circles if extend grid elements is set
            if (gridRevealRadius > 0) {
                const { x, y } = canvas.grid.getCenterPoint(position);
                hiddenMask.drawCircle(x, y, gridRevealRadius);
            } else {
                // Otherwise just uncover the revealed grid
                const poly = this._getGridPolygon(position);
                hiddenMask.drawPolygon(poly);
            }
        }

        // Uncover observer tokens, if set
        const tokenRevealRadius = Math.max(Number(this.scene.getFlag(MODULE, "revealRadius")) || 0, 0);
        if (tokenRevealRadius > 0) {
            for (const token of canvas.tokens.placeables) {
                const document = token.document;
                if (document.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY || document.hasPlayerOwner) {
                    const { x, y } = token.center;
                    hiddenMask.drawCircle(x, y, token.getLightRadius(tokenRevealRadius));
                }
            }
        }

        hiddenMask.endFill();

        // Render the mask
        canvas.app.renderer.render(hiddenMask, { renderTexture: this.hiddenTilesMaskTexture });
        hiddenMask.destroy();
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
        return this._getIndex(position.x, position.y) > -1;
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
    _getIndex(...point) {
        const { i, j } = canvas.grid.getOffset({ x: point[0], y: point[1] });
        return this.revealed.findIndex((r) => r.i === i && r.j === j);
    }

    /** Attempt to migrate from older positions (absolute coords) to newer positions (row/col). */
    #migratePositions() {
        const flags = this.settings;
        if ("revealed" in flags) {
            const newRevealed = flags.revealed.map((position) => canvas.grid.getGridPositionFromPixels(...position));
            canvas.scene.flags["world-explorer"].revealed = null;
            this.scene.update({
                "flags.world-explorer.revealedPositions": newRevealed,
                "flags.world-explorer.-=revealed": null,
            });
            ui.notifications.info(game.i18n.localize("WorldExplorer.Notifications.Migrated"));
            return true;
        }

        return false;
    }
}