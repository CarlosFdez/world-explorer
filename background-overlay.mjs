function makePositionKey(position) {
    return `${position[0]}_${position[1]}`;
}

const MODULE = "world-explorer";

export class BackgroundOverlay {
    initialized = false;

    constructor(scene) {
        this.scene = scene;
        this.color = 0xCCCCCC;
        this.state = {};

        const flags = scene.data.flags[MODULE];
        this._enabled = flags.enabled;
        this.color = flags.color || 0;
        this.initialize();

        // this will start loading the image, so do it last
        this.image = flags.image;
    }

    initialize() {
        const dimensions = canvas.dimensions;

        // Draw and add the overlay immediately first.
        // Attempt to not let players see anything until after it loads
        this.overlay = new PIXI.Graphics();
        this.overlay.alpha = this.alpha;
        this.refreshOverlay();
        if (this.enabled) {
            canvas.background.addChild(this.overlay);
        }

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
    }

    /** Canvas ready again. Anything we added to the background must be re-added */
    ready() {
        if (this.enabled) {
            //canvas.background.addChild(this.overlay); 
            this.overlay.addChild(this.mask);
            this.overlay.mask = this.mask;
            this._resetState();
            this.refreshMask();
        }
        canvas.grid.addHighlightLayer("exploration");
        this._registerMouseListeners();
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
    
    get alpha() {
        return game.user.isGM ? 0.7 : 1;
    }

    get enabled() {
        return !!this._enabled;
    }

    set enabled(value) {
        this._enabled = value;
        
        if (value) {
            canvas.background.addChild(this.overlay);
            this.refreshOverlay();
            this.refreshMask();
        } else {
            canvas.background.removeChild(this.overlay);
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

    set image(image) {
        this._image = image;
        this.refreshImage();
    }

    get image() {
        return this._image;
    }

    refreshImage() {
        if (this.enabled && this.image) {
            loadTexture(this.image).then((texture) => {
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
        const dimensions = canvas.dimensions;
        const graphic = new PIXI.Graphics();
        graphic.beginFill(0xFFFFFF);
        graphic.drawRect(0, 0, dimensions.width, dimensions.height);
        graphic.beginFill(0x000000);

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
        canvas.stage.addListener('pointerdown', (event) => {
            if (!this.enabled) return;
            
            if (this.editing && event.data.button === 0) {
                const rawPosition = event.data.getLocalPosition(canvas.app.stage);
                if (!this.reveal(rawPosition.x, rawPosition.y)) {
                    this.unreveal(rawPosition.x, rawPosition.y);
                }
            }
        });

        canvas.stage.addListener('pointermove', (event) => {
            if (!this.enabled) return;

            if (this.editing) {
                // Get mouse position translated to canvas coords
                const position = event.data.getLocalPosition(canvas.app.stage);
                const [x, y] = canvas.grid.getTopLeft(position.x, position.y);
                canvas.grid.clearHighlightLayer("exploration");
                const color = this.isRevealed(position.x, position.y) ? 0xFF0000 : 0x0022FF;
                canvas.grid.highlightPosition("exploration", { x, y, color, border: 0xFF0000 });
            }
        });
    }
}