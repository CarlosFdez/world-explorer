import { expandPolygon, translatePolygon } from "./util.mjs";

const MODULE = "world-explorer";

export const DEFAULT_SETTINGS = {
    color: "#000000",
    revealRadius: 0,
    gridRevealRadius: 0,
    opacityGM: 0.7,
    opacityPlayer: 1,
    persistExploredAreas: false,
    zIndex: 101,
};

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

    constructor() {
        super();
        this.color = "#000000";

        /** @type {Partial<WorldExplorerState>} */
        this.state = {};
    }

    /** 
     * Controls the sorting position of world explorer relative to other layers.
     * Tiles by default have a z-indez of 100. 
     */
    get sort() {
        return this.settings.zIndex ?? 101;
    }

    /** @returns {WorldExplorerFlags} */
    get settings() {
        const settings = this.scene.flags[MODULE] ?? {};
        return { ...DEFAULT_SETTINGS, ...settings };
    }

    /**
     * Get a GridHighlight layer for this Ruler
     * @type {GridHighlight}
     */
    get highlightLayer() {
        return canvas.grid.highlightLayers[this.name] || canvas.grid.addHighlightLayer(this.name);
    }

    get revealed() {
        return this.scene.getFlag(MODULE, "revealedPositions") ?? [];
    }

    initialize() {
        this.overlayBackground = new PIXI.Graphics();
        this.overlayBackground.tint = Color.from(this.color) ?? 0x000000;

        // Create mask (to punch holes in to reveal tiles/players)
        this.maskSprite = new PIXI.Sprite();
        
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

    activate() {
        super.activate();
        // todo: figure out interaction layer
    }

    deactivate() {
        super.deactivate();
        // todo: figure out interaction layer
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

        // Needed to offset a growing graphic that was drown to negative indices (hex maps)
        const minCoords = [0, 0];

        // draw black over the tiles that are revealed
        const gridRevealRadius = this.getGridRevealRadius();
        for (const position of this.scene.getFlag(MODULE, "revealedPositions") ?? []) {
            const poly = this._getGridPolygon(...position);
            graphic.drawPolygon(poly);

            // Update min coordinates. Even values are X values, and odd values are Y values
            minCoords[0] = Math.min(minCoords[0], ...poly.points.filter((_, idx) => idx % 2 === 0));
            minCoords[1] = Math.min(minCoords[1], ...poly.points.filter((_, idx) => idx % 2 !== 0));

            // If we want grid elements to have an extended reveal, we need to draw those too
            if (gridRevealRadius > 0) {
                const coords = canvas.grid.grid.getPixelsFromGridPosition(...position);
                const [x, y] = canvas.grid.getCenter(...coords).map(Math.round);
                graphic.drawCircle(x, y, gridRevealRadius);
                minCoords[0] = Math.min(minCoords[0], x - gridRevealRadius);
                minCoords[1] = Math.min(minCoords[1], y - gridRevealRadius);
            }
        }

        // draw black over observer tokens
        const tokenrevealRadius = Math.max(Number(this.scene.getFlag(MODULE, "revealRadius")) || 0, 0);
        if (tokenrevealRadius > 0) {
            for (const token of canvas.tokens.placeables) {
                if (!token.observer) continue;
                const x = token.center.x;
                const y = token.center.y;
                graphic.drawCircle(x, y, token.getLightRadius(tokenrevealRadius));
                minCoords[0] = Math.min(minCoords[0], x - tokenrevealRadius);
                minCoords[1] = Math.min(minCoords[1], y - tokenrevealRadius);
            }
        }

        graphic.endFill();
        this.maskSprite.texture = canvas.app.renderer.generateTexture(graphic);
        this.maskSprite.position.set(...minCoords);
        graphic.destroy();
    }

    /** Returns the grid reveal distance in canvas coordinates (if configured) */
    getGridRevealRadius() {
        const gridRadius = Math.max(Number(this.scene.getFlag(MODULE, "gridRevealRadius")) || 0, 0);
        if (!(gridRadius > 0)) return 0;

        // Convert from units to pixel radius, stolen from token.getLightRadius()
        const u = Math.abs(gridRadius);
        const hw = (canvas.grid.w / 2);
        return (((u / canvas.dimensions.distance) * canvas.dimensions.size) + hw) * Math.sign(gridRadius);
    }

    /**
     * Returns true if a grid coordinate (x, y) is revealed.
     * @param {PointArray[]} position
     */
    isRevealed(...position) {
        return this._getIndex(...position) > -1;
    }

    /** 
     * Reveals a coordinate and saves it to the scene
     * @param {PointArray[]} position
     */
    reveal(...position) {
        if (!this.enabled) return;

        const [x, y] = position;
        if (!this.isRevealed(x, y)) {
            const position = canvas.grid.grid.getGridPositionFromPixels(x, y);
            const existing = this.scene.getFlag(MODULE, "revealedPositions") ?? [];
            existing.push(position);
            this.scene.setFlag(MODULE, "revealedPositions", [...existing]);
            return true;
        }
        
        return false;
    }

    /** Unreveals a coordinate and saves it to the scene */
    unreveal(x, y) {
        if (!this.enabled) return;
        const idx = this._getIndex(x, y);
        if (idx > -1) {
            const existing = this.scene.getFlag(MODULE, "revealedPositions") ?? [];
            existing.splice(idx, 1);
            this.scene.setFlag(MODULE, "revealedPositions", [...existing]);
            return true;
        }

        return false;
    }

    /** Clears the entire scene. If reveal: true is passed, reveals all positions instead */
    clear(options) {
        const reveal = options?.reveal ?? false;
        if (reveal) {
            // Add a reveal for every grid position. If this is a hex grid, we also need to mark negative positions by one.
            const d = canvas.dimensions;
            const dimensions = canvas.grid.grid.getGridPositionFromPixels(d.width - 1, d.height - 1);
            if (canvas.grid.isHex) {
                dimensions[0] += 1;
                dimensions[1] += 1;
            }
            const newPositions = [];
            for (let row = 0; row < dimensions[0]; row++) {
                for (let col = 0; col < dimensions[1]; col++) {
                    newPositions.push([row, col]);
                }
            }
            this.scene.setFlag(MODULE, "revealedPositions", newPositions);
        } else {
            this.scene.setFlag(MODULE, "revealedPositions", []);
        }
    }

    onCanvasReady() {
        this.refreshMask();
        this.registerMouseListeners();
    }

    registerMouseListeners() {
        // Renders the highlight to use for the grid's future status
        const renderHighlight = (position, reveal) => {
            const [x, y] = canvas.grid.getTopLeft(position.x, position.y);
            this.highlightLayer.clear();
            
            // In certain modes, we only go one way, check if the operation is valid
            const canReveal = ["toggle", "reveal"].includes(this.state.tool);
            const canHide = ["toggle", "hide"].includes(this.state.tool);
            if ((reveal && canReveal) || (!reveal && canHide)) {
                const color = reveal ? 0x0022FF : 0xFF0000;
                canvas.grid.grid.highlightGridPosition(this.highlightLayer, { x, y, color, border: 0xFF0000 });
            }
        };

        canvas.stage.addListener('pointerdown', (event) => {
            if (!this.enabled) return;

            const canReveal = ["toggle", "reveal"].includes(this.state.tool);
            const canHide = ["toggle", "hide"].includes(this.state.tool);
            
            if (this.editing && event.data.button === 0) {
                const coords = event.data.getLocalPosition(canvas.app.stage);
                const revealed = this.isRevealed(coords.x, coords.y);
                if (revealed && canHide) {
                    this.unreveal(coords.x, coords.y);
                } else if (!revealed && canReveal) {
                    this.reveal(coords.x, coords.y)
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
            const revealed = this.isRevealed(coords.x, coords.y)
            renderHighlight(coords, !revealed);

            // For brush or eraser modes, allow click drag drawing
            if (event.data.buttons === 1 && this.state.tool !== "toggle") {
                const coords = event.data.getLocalPosition(canvas.app.stage);
                const revealed = this.isRevealed(coords.x, coords.y);
                if (revealed && this.state.tool == "hide") {
                    this.unreveal(coords.x, coords.y);
                } else if (!revealed && this.state.tool === "reveal") {
                    this.reveal(coords.x, coords.y);
                }
            }
        });
    }

    /**
     * Gets the grid polygon from a grid position (row and column).
     */
    _getGridPolygon(row, column) {
        const [x, y] = canvas.grid.grid.getPixelsFromGridPosition(row, column);
        if (canvas.grid.isHex) {
            // Hexes are vulnerable to roundoff errors, which can create thin gaps between cells.
            // We shift the center to a whole number, shift the polygon, then expand the polygon to whole number coords
            // Shifting the center allows us to handle Hexagonal Column configurations when expanded
            const center = canvas.grid.grid.getCenter(x, y);
            const delta = center.map(v => Math.round(v) - v);
            const hexPolygon = new PIXI.Polygon(canvas.grid.grid.getPolygon(x, y));
            hexPolygon.points = hexPolygon.points.map((v, idx) => v + delta[idx % 2]);
            return expandPolygon(hexPolygon, center.map(Math.round));
        } else {
            const size = canvas.grid.size;
            return new PIXI.Polygon(x, y, x+size, y, x+size, y+size, x, y+size);
        }
    }

    /** @param {PointArray[]} point */
    _getIndex(...point) {
        const [row, col] = canvas.grid.grid.getGridPositionFromPixels(...point);
        return this.revealed.findIndex(([revealedRow, revealedCol]) => revealedRow === row && revealedCol === col);
    }

    /** Attempt to migrate from older positions (absolute coords) to newer positions (row/col). */
    #migratePositions() {
        const flags = this.settings;
        if ("revealed" in flags) {
            const newRevealed = flags.revealed.map((position) => canvas.grid.grid.getGridPositionFromPixels(...position));
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