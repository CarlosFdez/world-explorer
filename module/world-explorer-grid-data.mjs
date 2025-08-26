import { offsetToString } from "./util.mjs";

/** Contains the grid data for the world */
export class WorldExplorerGridData {
    /** @type {GridEntry[]} */
    revealed;

    /** @type {GridEntry[]} */
    partials;

    /**
     * @param {Record<string, GridEntry>} data
     */
    constructor(data) {
        this.data = data;

        const values = Object.values(this.data);
        this.revealed = values.filter((d) => d.reveal === true);
        this.partials = values.filter((d) => d.reveal === "partial");
    }

    /**
     * TODO: Consider returning default data instead of null
     * @param {CoordsOrOffset} coordsOrOffset
     * @returns {GridEntry | null}
     */
    get({ coords = null, offset = null }) {
        if (!coords && !offset) return null;
        offset ??= canvas.grid.getOffset(coords);
        const key = offsetToString(offset);
        return this.data[key] ?? null;
    }
}
