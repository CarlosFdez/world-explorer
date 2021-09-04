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
        this.color = 0xCCCCCC;
        this.alpha = game.user.isGM ? 0.7 : 1;
        this.state = {};

        const flags = scene.data.flags[MODULE];
        this._enabled = flags.enabled;
        this.color = flags.color || 0;
        this.image = flags.image;
    }

    initialize() {
        if (this._initialized) return;
        const dimensions = canvas.dimensions;

        // Draw and add the overlay immediately first.
        this.overlay = new PIXI.Graphics();

        // Create mask (to punch holes in to reveal tiles/players)
        this.maskTexture = PIXI.RenderTexture.create({
            width: dimensions.width,
            height: dimensions.height,
        });
        this.mask = PIXI.Sprite.from(this.maskTexture);

        // Create mask to put players on
        this.fogSprite = new PIXI.Sprite();
        this.fogSprite.position.set(dimensions.sceneRect.x, dimensions.sceneRect.y);
        this.fogSprite.width = dimensions.sceneRect.width;
        this.fogSprite.height = dimensions.sceneRect.height;
        this.overlay.addChild(this.fogSprite);

        this._initialized = true;

        this.refreshImage();
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
        this.addChild(this.mask);
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
        } else {
            this.refreshMask();
        }
    }

    get enabled() {
        return !!this._enabled;
    }

    set enabled(value) {
        this._enabled = value;
        
        if (value) {
            this.visible = true;
            this.refreshOverlay();
            this.refreshMask();
        } else {
            this.visible = false;
            this.overlay.clear();
            this._resetState();
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
        this.overlay.beginFill(this.color);
        this.overlay.drawRect(0, 0, canvas.dimensions.width, canvas.dimensions.height);
        this.overlay.endFill();
    }

    refreshMask() {
        if (!this.enabled) return;
        const graphic = new PIXI.Graphics();
        graphic.beginFill(0xFFFFFF);
        graphic.drawRect(0, 0, this.width, this.height);
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
                graphic.drawRectangle(x, y, dimensions.size, dimensions.size);
            }
        }

        // draw black over observer tokens
        for (const token of canvas.tokens.placeables) {
            if (!token.observer) continue;
            const x = token.center.x;
            const y = token.center.y;
            graphic.drawCircle(x, y, circleSize);
        }

        canvas.app.renderer.render(graphic, this.maskTexture);
    }

    isRevealed(x, y) {
        const position = canvas.grid.getCenter(x, y).map(Math.round);
        const existing = this.scene.getFlag(MODULE, "revealed");
        const key = makePositionKey(position);
        return existing.some((existing) => makePositionKey(existing) === key);
    }

    reveal(x, y) {
        if (!this.enabled) return;

        const position = canvas.grid.getCenter(x, y).map(Math.round);
        if (!this.isRevealed(...position)) {
            const existing = this.scene.getFlag(MODULE, "revealed");
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