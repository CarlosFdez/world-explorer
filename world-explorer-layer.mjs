function makePositionKey(position) {
    return `${position[0]}_${position[1]}`;
}

const MODULE = "world-explorer";

export class WorldExplorerLayer extends CanvasLayer {
    _ready = false;
    _initialized = false;

    constructor() {
        super();

        const scene = canvas.scene;
        this.scene = scene;
        this.color = "#000000";
        this.alpha = game.user.isGM ? 0.7 : 1;
        this.state = {};

        const flags = scene.data.flags[MODULE] ?? {};
        this._enabled = flags.enabled;
        this.color = flags.color || 0;
        this.image = flags.image;
        
        // Create sprite to draw fog of war image over. Because of load delays, create this first
        // It will get added to the overlay later
        const dimensions = canvas.dimensions;
        this.fogSprite = new PIXI.Sprite();
        this.fogSprite.position.set(dimensions.sceneRect.x, dimensions.sceneRect.y);
        this.fogSprite.width = dimensions.sceneRect.width;
        this.fogSprite.height = dimensions.sceneRect.height;
        this.refreshImage();
    }

    initialize() {
        if (this._initialized) return;
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

        this._initialized = true;
        this.visible = this._enabled;
    }

    /** Canvas ready again. Anything we added to the background must be re-added */
    ready() {
        this.initialize();
        this._ready = true;
        if (this.enabled) {
            this._resetState();
            this.refreshMask();
        }
        canvas.grid.addHighlightLayer("exploration");
        this._registerMouseListeners();
    }

    async draw() {
        await super.draw();
        this.initialize();
        this.addChild(this.overlay);
        this.refreshOverlay();
        this.refreshMask();
        return this;
    }

    update(scene) {
        this.scene = scene;
        const { enabled, color, image } = scene.data.flags[MODULE];
        const diff = enabled !== this.enabled || color !== this.color || image !== this.image;
        this.color = color;
        this.image = image;

        // Setting enabled state will trigger re-renders if necessary
        if (diff) {
            this.enabled = enabled;
            this.refreshImage();
        } else {
            this.refreshMask();
        }
    }

    get enabled() {
        return !!this._enabled;
    }

    set enabled(value) {
        this._enabled = value;
        this.visible = value;
        
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

    set editing(value) {
        if (!this.enabled) return;
        this.state.clearing = value;
        canvas.grid.clearHighlightLayer("exploration");
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

        // If not ready, stop now. We only want to cover the screen
        if (!this._ready) return;

        const dimensions = canvas.dimensions;
        const circleSize = dimensions.size * Math.SQRT2 / 2;

        // draw black over the tiles that are revealed
        for (const position of this.scene.getFlag(MODULE, "revealed") ?? []) {
            const [x, y] = canvas.grid.getTopLeft(...position);
            if (canvas.grid.isHex) {
                const poly = canvas.grid.grid.getPolygon(x, y);
                graphic.drawPolygon(poly);
            } else {
                graphic.drawRect(x, y, dimensions.size, dimensions.size);
            }
        }

        // draw black over observer tokens
        for (const token of canvas.tokens.placeables) {
            if (!token.observer) continue;
            const x = token.center.x;
            const y = token.center.y;
            graphic.drawCircle(x, y, circleSize);
        }

        graphic.endFill();
        canvas.app.renderer.render(graphic, this.maskTexture);
        graphic.destroy();
    }

    isRevealed(x, y) {
        const position = canvas.grid.getCenter(x, y).map(Math.round);
        const existing = this.scene.getFlag(MODULE, "revealed") ?? [];
        const key = makePositionKey(position);
        return existing.some((existing) => makePositionKey(existing) === key);
    }

    reveal(x, y) {
        if (!this.enabled) return;

        const position = canvas.grid.getCenter(x, y).map(Math.round);
        if (!this.isRevealed(...position)) {
            const existing = this.scene.getFlag(MODULE, "revealed") ?? [];
            this.scene.setFlag(MODULE, "revealed", [...existing, position]);
            return true;
        }
        
        return false;
    }

    unreveal(x, y) {
        if (!this.enabled) return;
        const position = canvas.grid.getCenter(x, y).map(Math.round);
        const existing = this.scene.getFlag(MODULE, "revealed") ?? [];
        const idx = existing.findIndex((existing) => existing[0] === position[0] && existing[1] === position[1]);
        if (idx >= 0) {
            existing.splice(idx, 1);
            this.scene.setFlag(MODULE, "revealed", [...existing]);
            return true;
        }

        return false;
    }

    _resetState() {
        this.state = {};
        this.editing = false;
    }

    _registerMouseListeners() {
        const renderHighlight = (position, revealed) => {
            const [x, y] = canvas.grid.getTopLeft(position.x, position.y);
            canvas.grid.clearHighlightLayer("exploration");
            const color = revealed ? 0xFF0000 : 0x0022FF;
            canvas.grid.highlightPosition("exploration", { x, y, color, border: 0xFF0000 });
        };

        canvas.stage.addListener('pointerdown', (event) => {
            if (!this.enabled) return;
            
            if (this.editing && event.data.button === 0) {
                const position = event.data.getLocalPosition(canvas.app.stage);
                const revealed = this.isRevealed(position.x, position.y);
                if (revealed) {
                    this.unreveal(position.x, position.y);
                } else {
                    this.reveal(position.x, position.y)
                }

                renderHighlight(position, !revealed);
            }
        });

        canvas.stage.addListener('pointermove', (event) => {
            if (!this.enabled) return;

            if (this.editing) {
                // Get mouse position translated to canvas coords
                const position = event.data.getLocalPosition(canvas.app.stage);
                const revealed = this.isRevealed(position.x, position.y)
                renderHighlight(position, revealed);
            }
        });
    }
}