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
    revealRadius: 0,
    gridRevealRadius: 0,
    opacityGM: 0.7,
    opacityPlayer: 1,
    persistExploredAreas: false,
    position: "behindDrawings",
};

// DEV NOTE: On sorting layers
// Elements within the primary canvas group are sorted via the following heuristics:
// 1. The object's elevation property. Drawables use their ZIndex, Tiles have a fixed value if overhead
// 2. The layer's static PRIMARY_SORT_ORDER.
// 3. The object's sort property

/** 
 * The world explorer canvas layer, which is added to the primary canvas layer.
 * The primary canvas layer is host to the background, and the actual token/drawing/tile sprites.
 * The separate token/drawing/tiles layers in the interaction layer are specifically for drawing borders and rendering the hud.
 */
export class WorldExplorerLayer extends InteractionLayer {
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
        this.color = "#000000";

        /** @type {Partial<WorldExplorerState>} */
        this.state = {};
    }

    /** Any settings we are currently previewing. Currently unused, will be used once we're mot familiar with the scene config preview */ 
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
        this.overlayBackground = new PIXI.Graphics();
        this.overlayBackground.tint = Color.from(this.color) ?? 0x000000;

        // Create mask (to punch holes in to reveal tiles/players)
        const dimensions = canvas.dimensions;
        this.maskTexture = PIXI.RenderTexture.create({
            width: dimensions.sceneRect.width,
            height: dimensions.sceneRect.height,
        })
        this.maskSprite = new PIXI.Sprite();
        this.maskSprite.texture = this.maskTexture;
        
        // Create the overlay
        this.addChild(this.overlayBackground);
        this.addChild(this.fogSprite);
        this.addChild(this.maskSprite);
        this.mask = this.maskSprite;

        const flags = this.settings;
        this.alpha = (game.user.isGM ? flags.opacityGM : flags.opacityPlayer) ?? 1;
        this.color = flags.color;
        this.image = flags.image;
        this._enabled = flags.enabled;

        this.visible = this._enabled;

        this.#migratePositions();
    }

    async _draw() {
        const scene = canvas.scene;
        this.scene = scene;
        this.updater = new SceneUpdater(scene);
        
        // Create sprite to draw fog of war image over. Because of load delays, create this first
        // It will get added to the overlay later
        const dimensions = canvas.dimensions;
        this.fogSprite = new PIXI.Sprite();
        this.fogSprite.position.set(dimensions.sceneRect.x, dimensions.sceneRect.y);
        this.fogSprite.width = dimensions.sceneRect.width;
        this.fogSprite.height = dimensions.sceneRect.height;

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
        this.alpha = (game.user.isGM ? flags.opacityGM : flags.opacityPlayer) ?? 1;
        this.color = flags.color;
        this.image = flags.image;
        this._enabled = flags.enabled;
        this.visible = this._enabled;

        this.refreshMask();
        if (becameEnabled) {
            this.refreshOverlay();
        }
        if (imageChanged || !flags.enabled || becameEnabled) {
            this.refreshImage();
        }
    }

    // Work around foundry bug https://github.com/foundryvtt/foundryvtt/issues/10201
    activate() {
        if (!this.enabled) {
            const control = ui.controls.controls[0];
            ui.controls.initialize({ layer: control.layer });
            return this.deactivate();
        }

        return super.activate();
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

    refreshImage(image=null) {
        image = this.image ?? image;
        if (this.enabled && image) {
            loadTexture(image).then((texture) => {
                this.fogSprite.texture = texture;
            });
        } else {
            this.fogSprite.texture = null;
        }
    }

    refreshOverlay() {
        if (!this.enabled || this.alpha === 0) return;
        this.overlayBackground.beginFill(0xFFFFFF);
        this.overlayBackground.drawRect(0, 0, canvas.dimensions.width, canvas.dimensions.height);
        this.overlayBackground.endFill();
        this.overlayBackground.tint = Color.from(this.color) ?? 0x000000;
    }

    refreshMask() {
        if (!this.enabled || this.alpha === 0) return;
        const graphic = new PIXI.Graphics();
        graphic.beginFill(0xFFFFFF);
        graphic.drawRect(0, 0, canvas.dimensions.width, canvas.dimensions.height);
        graphic.endFill();

        graphic.beginFill(0x000000);

        // draw black over the tiles that are revealed
        const gridRevealRadius = this.getGridRevealRadius();
        for (const position of this.revealed) {
            const poly = this._getGridPolygon(position);
            graphic.drawPolygon(poly);

            // If we want grid elements to have an extended reveal, we need to draw those too
            if (gridRevealRadius > 0) {
                const { x, y } = canvas.grid.getCenterPoint(position);
                graphic.drawCircle(x, y, gridRevealRadius);
            }
        }

        // draw black over observer tokens
        const tokenRevealRadius = Math.max(Number(this.scene.getFlag(MODULE, "revealRadius")) || 0, 0);
        if (tokenRevealRadius > 0) {
            for (const token of canvas.tokens.placeables) {
                const document = token.document;
                if (document.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY || document.hasPlayerOwner) {
                    const x = token.center.x;
                    const y = token.center.y;
                    graphic.drawCircle(x, y, token.getLightRadius(tokenRevealRadius));
                }
            }
        }

        const { sceneRect } = canvas.dimensions;
        graphic.position.set(-sceneRect.x, -sceneRect.y);
        
        graphic.endFill();
        canvas.app.renderer.render(graphic, { renderTexture: this.maskTexture });
        this.maskSprite.position.set(sceneRect.x, sceneRect.y);
        graphic.destroy();
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
    }

    registerMouseListeners() {
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

        canvas.stage.addListener('pointerdown', (event) => {
            if (!this.enabled) return;

            const canReveal = ["toggle", "reveal"].includes(this.state.tool);
            const canHide = ["toggle", "hide"].includes(this.state.tool);
            
            if (this.editing && event.data.button === 0) {
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
            if (!(this.enabled && this.editing)) return;

            // Get mouse position translated to canvas coords
            const coords = event.data.getLocalPosition(canvas.app.stage);
            const revealed = this.isRevealed(coords)
            renderHighlight(coords, !revealed);

            // For brush or eraser modes, allow click drag drawing
            if (event.data.buttons === 1 && this.state.tool !== "toggle") {
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