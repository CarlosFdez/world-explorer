const MODULE = "world-explorer";

export const DEFAULT_SETTINGS = {
    color: "#000000",
    revealRadius: 0,
    gridRevealRadius: 0,
    opacityGM: 0.7,
    opacityPlayer: 1,
    persistExploredAreas: false,
};

export class WorldExplorerLayer extends CanvasLayer {
    _initialized = false;

    constructor() {
        super();
        this.color = "#000000";
        this.state = {};
    }

    get settings() {
        const settings = this.scene.data.flags[MODULE] ?? {};
        return { ...DEFAULT_SETTINGS, ...settings };
    }

    initialize() {
        const dimensions = canvas.dimensions;

        this.overlayBackground = new PIXI.Graphics();
        this.overlayBackground.tint = colorStringToHex(this.color) ?? 0x000000;

        // Create mask (to punch holes in to reveal tiles/players)
        this.maskTexture = PIXI.RenderTexture.create({
            width: dimensions.width,
            height: dimensions.height,
        })
        const mask = PIXI.Sprite.from(this.maskTexture);
        
        // Create the overlay
        this.overlay = new PIXI.Graphics();
        this.overlay.addChild(this.overlayBackground);
        this.overlay.addChild(this.fogSprite);
        this.overlay.addChild(mask);
        this.overlay.mask = mask;
        this.addChild(this.overlay);

        const flags = this.settings;
        this.alpha = (game.user.isGM ? flags.opacityGM : flags.opacityPlayer) ?? 1;
        this.color = flags.color;
        this.image = flags.image;
        this._enabled = flags.enabled;

        this.visible = this._enabled;

        this.#migratePositions();
    }

    async draw() {
        const scene = canvas.scene;
        this.scene = scene;
        
        // Create sprite to draw fog of war image over. Because of load delays, create this first
        // It will get added to the overlay later
        const dimensions = canvas.dimensions;
        this.fogSprite = new PIXI.Sprite();
        this.fogSprite.position.set(dimensions.sceneRect.x, dimensions.sceneRect.y);
        this.fogSprite.width = dimensions.sceneRect.width;
        this.fogSprite.height = dimensions.sceneRect.height;

        // Do not add anything to the layer until after this is called (or it'll be wiped)
        await super.draw();

        this.initialize();
        this.refreshOverlay();
        this._resetState();
        this.refreshMask();
        this.refreshImage();
        
        canvas.grid.addHighlightLayer("exploration");

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
            this.overlay.clear();
        }
    }

    /** Returns true if the user is currently editing, false otherwise. */
    get editing() {
        return this.enabled && this.state.clearing;
    }

    startEditing(mode) {
        this.state.clearing = true;
        this.state.tool = mode;
        if (this.enabled) {
            canvas.grid.clearHighlightLayer("exploration");
        }
    }

    stopEditing() {
        this.state.clearing = false;
        if (this.enabled) {
            canvas.grid.clearHighlightLayer("exploration");
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
        if (!this.enabled) return;
        this.overlayBackground.beginFill(0xFFFFFF);
        this.overlayBackground.drawRect(0, 0, canvas.dimensions.width, canvas.dimensions.height);
        this.overlayBackground.endFill();
        this.overlayBackground.tint = colorStringToHex(this.color) ?? 0x000000;
    }

    refreshMask() {
        if (!this.enabled) return;
        const graphic = new PIXI.Graphics();
        graphic.beginFill(0xFFFFFF);
        graphic.drawRect(0, 0, this.width, this.height);
        graphic.endFill();

        graphic.beginFill(0x000000);

        // draw black over the tiles that are revealed
        const gridComputedRevealRadius = this.getGridRevealRadius(); 
        for (const position of this.scene.getFlag(MODULE, "revealedPositions") ?? []) {
            const poly = this._getGridPolygon(...position);
            graphic.drawPolygon(poly);

            // If we want grid elements to have an extended reveal, we need to draw those too
            if (gridComputedRevealRadius > 0) {
                const coords = canvas.grid.grid.getPixelsFromGridPosition(...position);
                const [x, y] = canvas.grid.getCenter(...coords).map(Math.round);
                graphic.drawCircle(x, y, gridComputedRevealRadius);
            }
        }

        // draw black over observer tokens
        const radius = Math.max(Number(this.scene.getFlag(MODULE, "revealRadius")) || 0, 0);
        if (radius > 0) {
            for (const token of canvas.tokens.placeables) {
                if (!token.observer) continue;
                const x = token.center.x;
                const y = token.center.y;
                graphic.drawCircle(x, y, token.getLightRadius(radius));
            }
        }

        graphic.endFill();
        canvas.app.renderer.render(graphic, this.maskTexture);
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
     * Returns true if a grid coordinate (x, y) is revealed
     */
    isRevealed(x, y) {
        return this._getIndex(x, y) > -1;
    }

    /** Reveals a coordinate and saves it to the scene */
    reveal(x, y) {
        if (!this.enabled) return;
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

    clear() {
        this.scene.setFlag(MODULE, "revealedPositions", []);
    }

    registerMouseListeners() {
        // Renders the highlight to use for the grid's future status
        const renderHighlight = (position, reveal) => {
            const [x, y] = canvas.grid.getTopLeft(position.x, position.y);
            canvas.grid.clearHighlightLayer("exploration");
            
            // In certain modes, we only go one way, check if the operation is valid
            const canReveal = ["toggle", "reveal"].includes(this.state.tool);
            const canHide = ["toggle", "hide"].includes(this.state.tool);
            if ((reveal && canReveal) || (!reveal && canHide)) {
                const color = reveal ? 0x0022FF : 0xFF0000;
                canvas.grid.highlightPosition("exploration", { x, y, color, border: 0xFF0000 });
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
     * Gets the grid polygon from a grid position (row and column)
     */
    _getGridPolygon(row, column) {
        const [x, y] = canvas.grid.grid.getPixelsFromGridPosition(row, column);
        if (canvas.grid.isHex) {
            return new PIXI.Polygon(canvas.grid.grid.getPolygon(x, y));
        } else {
            const size = canvas.grid.size;
            return new PIXI.Polygon(x, y, x+size, y, x+size, y+size, x, y+size);
        }
    }

    _getIndex(x, y) {
        const allRevealed = this.scene.getFlag(MODULE, "revealedPositions") ?? [];
        const [row, col] = canvas.grid.grid.getGridPositionFromPixels(x, y);
        return allRevealed.findIndex(([revealedRow, revealedCol]) => revealedRow === row && revealedCol === col);
    }

    _resetState() {
        this.stopEditing();
        this.state = {};
    }

    /** Attempt to migrate from older positions to newer positions. */
    #migratePositions() {
        const flags = this.settings;
        if ("revealed" in flags) {
            const newRevealed = flags.revealed.map((position) => canvas.grid.grid.getGridPositionFromPixels(...position));
            canvas.scene.data.flags["world-explorer"].revealed = null;
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