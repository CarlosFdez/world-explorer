import { debounceTrailing, uniq } from "./util.mjs";

const MODULE = "world-explorer";

export class SceneUpdater {
    constructor(scene) {
        this.scene = scene;
        this.hexUpdates = new Map();
        this.updating = false;
    }

    reveal(x, y) {
        const position = canvas.grid.grid.getGridPositionFromPixels(x, y);
        this.hexUpdates.set(position.toString(), {
            position,
            state: true,
        });
        this.#performUpdates();
    }

    hide(x, y) {
        const position = canvas.grid.grid.getGridPositionFromPixels(x, y);
        this.hexUpdates.set(position.toString(), {
            position,
            state: false,
        });
        this.#performUpdates();
    }

    clear(options) {
        this.hexUpdates.clear();

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

    #performUpdates = debounceTrailing(async () => {
        if (this.updating) return;

        const existing = this.scene.getFlag(MODULE, "revealedPositions") ?? [];
        const allUpdates = [...this.hexUpdates.values()];
        const adding = allUpdates.filter((s) => s.state).map((u) => u.position);
        const removing = new Set(allUpdates.filter((s) => !s.state).map((u) => String(u.position)));
        const newPositions = uniq([...existing, ...adding]).filter((p) => !removing.has(String(p)));

        this.hexUpdates.clear();
        if (String(newPositions) !== String(existing)) {
            this.updating = true;
            try {
                await this.scene.setFlag(MODULE, "revealedPositions", newPositions);
            } finally {
                this.updating = false;
                if (this.hexUpdates.size) {
                    this.#performUpdates();
                }
            }
        }
    }, 50);
}