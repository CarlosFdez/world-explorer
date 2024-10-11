import { uniqPosition } from "./util.mjs";

const MODULE = "world-explorer";

/** A wrapper around a scene used to handle persistance and sequencing */
export class SceneUpdater {
    constructor(scene) {
        this.scene = scene;
        this.hexUpdates = new Map();
        this.updating = false;
    }

    changeState(x, y, state = false) {
        const { i, j } = canvas.grid.getOffset({ x, y });
        const position = [i, j];
        this.hexUpdates.set(position.toString(), {
            position,
            state
        });
        this.#performUpdates();
    }

    reveal(x, y) {
        this.changeState(x, y, "reveal");
    }

    hide(x, y) {
        this.changeState(x, y, false);
    }

    partial(x, y) {
        this.changeState(x, y, "partial");
    }

    clear(options) {
        this.hexUpdates.clear();

        const reveal = options?.reveal ?? false;
        const partial = options?.partial ?? false;
        if (reveal || partial) {
            // Add a reveal or partial for every grid position. If this is a hex grid, we also need to mark negative positions by one.
            const state = reveal ? 'reveal' : 'partial';
            const d = canvas.dimensions;
            const offset = canvas.grid.getOffset({ x: d.width - 1, y: d.height - 1 });
            const dimensions = [offset.i, offset.j];
            if (canvas.grid.isHexagonal) {
                dimensions[0] += 1;
                dimensions[1] += 1;
            }
            const newPositions = [];
            for (let row = -1; row <= dimensions[0]; row++) {
                for (let col = -1; col <= dimensions[1]; col++) {
                    newPositions.push([row, col, state]);
                }
            }
            this.scene.setFlag(MODULE, "gridPositions", newPositions);
        } else {
            this.scene.setFlag(MODULE, "gridPositions", []);
        }
    }

    #performUpdates = foundry.utils.throttle(async () => {
        if (this.updating) return;

        const existing = this.scene.getFlag(MODULE, "gridPositions") ?? [];
        const allUpdates = [...this.hexUpdates.values()];
        const adding = allUpdates.filter((s) => s.state).map((u) => [...u.position, u.state]);
        const removing = new Set(allUpdates.filter((s) => !s.state).map((u) => String(u.position)));
        const newPositions = uniqPosition([...adding, ...existing]).filter((p) => !removing.has(String(p.slice(0,-1))));

        this.hexUpdates.clear();
        this.updating = true;
        try {
            await this.scene.setFlag(MODULE, "gridPositions", newPositions);
        } finally {
            this.updating = false;
            if (this.hexUpdates.size) {
                this.#performUpdates();
            }
        }
    }, 50);
}