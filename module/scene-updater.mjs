import { offsetToString } from "./util.mjs";
import { MODULE } from "../index.js";

/**
 * A wrapper around a scene used to handle persistence and sequencing
 * todo: move functionality to WorldExplorerGridData to handle optimistic updates better
 */
export class SceneUpdater {
    constructor(scene) {
        this.scene = scene;
        this.hexUpdates = new Map();
        this.updating = false;
        this.paddedSceneRect = canvas.dimensions.sceneRect.clone().pad(canvas.grid.size);
    }

    /**
     * Updates a specific coordinate or offset with new data
     * @param {CoordsOrOffset} position
     * @param {{ reveal: boolean | "partial"}} param1
     */
    update({ coords = null, offset = null }, { reveal = false }) {
        if (!coords && !offset) return;
        if (typeof reveal !== "boolean" && reveal !== "partial") {
            throw new Error("Invalid type, reveal must be a boolean or the value partial");
        }

        // Ignore if this is outside the map's grid (sceneRect + padding of 1 grid size)
        if (coords && !this.paddedSceneRect.contains(coords.x, coords.y)) return;

        offset ??= canvas.grid.getOffset(coords);
        const key = offsetToString(offset);
        this.hexUpdates.set(key, { offset, reveal });
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
            const newPositions = {};
            for (let i = startOffset.i; i <= endOffset.i; i++) {
                for (let j = startOffset.j; j <= endOffset.j; j++) {
                    const offset = { i, j };
                    const key = offsetToString(offset);
                    newPositions[key] = { offset, reveal };
                }
            }
            this.scene.setFlag(MODULE, "gridData", newPositions);
        } else {
            this.scene.unsetFlag(MODULE, "gridData");
        }
    }

    #performUpdates = foundry.utils.debounce(async () => {
        if (this.updating) return;

        const updates = {};
        const flagBase = `flags.${MODULE}.gridData`;
        for (const [key, value] of this.hexUpdates.entries()) {
            if (value.reveal === false) {
                updates[`${flagBase}.-=${key}`] = null;
            } else {
                updates[`${flagBase}.${key}`] = value;
            }
        }

        this.hexUpdates.clear();
        this.updating = true;
        try {
            await this.scene.update(updates);
        } finally {
            this.updating = false;
            if (this.hexUpdates.size) {
                this.#performUpdates();
            }
        }
    }, 50);
}
