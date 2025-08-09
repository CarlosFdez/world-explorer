import { uniq } from "./util.mjs";

const MODULE = "world-explorer";

/** A wrapper around a scene used to handle persistence and sequencing */
export class SceneUpdater {
    constructor(scene) {
        this.scene = scene;
        this.hexUpdates = new Map();
        this.updating = false;
        this.paddedSceneRect = canvas.dimensions.sceneRect.clone().pad(canvas.grid.size);
    }

    reveal(x, y) {
        this.changeState(x, y, true);
    }

    hide(x, y) {
        this.changeState(x, y, false);
    }

    changeState(x, y, state = false) {
        // Ignore if this is outside the map's grid (sceneRect + padding of 1 grid size)
        if (!this.paddedSceneRect.contains(x, y)) return;

        const position = [i, j];
        this.hexUpdates.set(position.toString(), {
            position,
            state,
        });
        this.#performUpdates();
    }

    clear(options) {
        this.hexUpdates.clear();

        const reveal = options?.reveal ?? false;
        if (reveal) {
            // Add a reveal for every grid position that is on the map (i.e. not in the padding)
            const { x, y, width, height } = canvas.dimensions.sceneRect;
            // First grid square/hex that is on the map (sceneRect)
            const startOffset = canvas.grid.getOffset({ x: x + 1, y: y + 1 });
            // Last grid square/hex that is on the map (sceneRect)
            const endOffset = canvas.grid.getOffset({ x: x + width - 1, y: y + height - 1 });
            // Compensate for hexes being weird
            // TODO: improve this by looking at the different hex grid types
            if (canvas.grid.isHexagonal) {
                startOffset.i -= 1;
                startOffset.j -= 1;
                endOffset.i += 1;
                endOffset.j += 1;
            }
            const newPositions = [];
            for (let i = startOffset.i; i <= endOffset.i; i++) {
                for (let j = startOffset.j; j <= endOffset.j; j++) {
                    newPositions.push([i, j]);
                }
            }
            this.scene.setFlag(MODULE, "revealedPositions", newPositions);
        } else {
            this.scene.setFlag(MODULE, "revealedPositions", []);
        }
    }

    #performUpdates = foundry.utils.throttle(async () => {
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