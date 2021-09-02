function makePositionKey(position) {
    return `${position[0]}_${position[1]}`;
}

export class BackgroundOverlay {
    constructor(scene) {
        this.scene = scene;
        this.color = 0xCCCCCC;
        this.state = { clearing: false };
        const dimensions = canvas.dimensions;

        this._enabled = scene.getFlag("world-explorer", "enabled"); // pull from scene
        
        // Draw and add the overlay immediately first.
        // Attempt to not let players see anything until after it loads
        this.overlay = new PIXI.Graphics();
        this.overlay.alpha = this.alpha;
        this.refreshOverlay();
        if (this.enabled) {
            canvas.background.addChild(this.overlay);
        }

        // Create mask (to punch holes in)
        this.maskTexture = PIXI.RenderTexture.create({
            width: dimensions.width,
            height: dimensions.height,
        });
        this.mask = PIXI.Sprite.from(this.maskTexture);

        this.fogSprite = new PIXI.Sprite();
        this.fogSprite.position.set(dimensions.sceneRect.x, dimensions.sceneRect.y);
        this.fogSprite.width = dimensions.sceneRect.width;
        this.fogSprite.height = dimensions.sceneRect.height;

        // hardcoded for now, will need to make it customizable
        loadTexture("worlds/aftaras/scenes/world-drawn.png").then((texture) => {
            this.fogSprite.texture = texture;
        })

        this.overlay.addChild(this.fogSprite);
    }

    /** Canvas ready again. Anything we added to the background must be re-added */
    ready() {
        if (this.enabled) {
            canvas.background.addChild(this.overlay); 
            this.overlay.addChild(this.mask);
            this.overlay.mask = this.mask;
            this.refreshMask();
        }
        canvas.grid.addHighlightLayer("exploration");
        this._registerMouseListeners();
    }

    get enabled() {
        return !!this._enabled;
    }

    set enabled(value) {
        this._enabled = value;
        
        if (value) {
            canvas.background.addChild(this.overlay);
            this.refreshOverlay();
            this.scene.setFlag("world-explorer", "enabled", true);
        } else {
            canvas.background.removeChild(this.overlay);
            this.overlay.clear();
        }
    }

    get alpha() {
        return game.user.isGM ? 0.7 : 1;
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
        for (const position of this.scene.getFlag("world-explorer", "revealed") ?? []) {
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
        const existing = this.scene.getFlag("world-explorer", "revealed");
        const key = makePositionKey(position);
        return existing.some((existing) => makePositionKey(existing) === key);
    }

    reveal(x, y) {
        if (!this.enabled) return;

        const position = canvas.grid.getCenter(x, y).map(Math.round);
        if (!this.isRevealed(...position)) {
            const existing = this.scene.getFlag("world-explorer", "revealed");
            this.scene.setFlag("world-explorer", "revealed", [...existing, position]);
            return true;
        }
        
        return false;
    }

    unreveal(x, y) {
        if (!this.enabled) return;
        const position = canvas.grid.getCenter(x, y).map(Math.round);
        const existing = this.scene.getFlag("world-explorer", "revealed") ?? [];
        const idx = existing.findIndex((existing) => existing[0] === position[0] && existing[1] === position[1]);
        if (idx >= 0) {
            existing.splice(idx, 1);
            this.scene.setFlag("world-explorer", "revealed", [...existing]);
            return true;
        }

        return false;
    }

    _registerMouseListeners() {
        canvas.stage.addListener('pointerdown', (event) => {
            if (!this.enabled) return;
            
            if (this.state.clearing && event.data.button === 0) {
                const rawPosition = event.data.getLocalPosition(canvas.app.stage);
                if (!this.reveal(rawPosition.x, rawPosition.y)) {
                    this.unreveal(rawPosition.x, rawPosition.y);
                }
            }
        });

        canvas.stage.addListener('pointermove', (event) => {
            if (!this.enabled) return;

            if (this.state.clearing) {
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