/**
 *
 * @param {unknown} object
 * @param {{ before?: string, after?: string, key: string, value: unknown }} options
 * @returns
 */
export function insertIntoObject(object, options) {
    const result = {};
    for (const [key, value] of Object.entries(object)) {
        if (key === options.before) {
            result[options.key] = options.value;
        }
        result[key] = value;
        if (key === options.after && !(options.key in result)) {
            result[options.key] = options.value;
        }
    }

    for (const key of Object.keys(object)) {
        delete object[key];
    }
    mergeObject(object, result);

    return result;
}

function relativeAdjust(value, reference) {
    if (value < reference) {
        return Math.floor(value);
    } else if (value > reference) {
        return Math.ceil(value);
    }
    return value;
}

/** Some polygons may have fractional parts, we round outwards so they tile nicely */
export function expandPolygon(polygon, center) {
    for (const idx in polygon.points) {
        const value = polygon.points[idx];
        if (idx % 2 === 0) {
            polygon.points[idx] = relativeAdjust(value, center[0]);
        } else {
            polygon.points[idx] = relativeAdjust(value, center[1]);
        }
    }

    return polygon;
}

export function translatePolygon(polygon, translate) {
    for (const idx of polygon.points) {
        if (idx % 2 === 0) {
            polygon.points[idx] += translate[0];
        } else {
            polygon.points[idx] += translate[1];
        }
    }

    return polygon;
}

// Get a unique identifier string from the offset object
export function offsetToString(entry) {
    const offset = entry.offset ?? entry;
    return `${offset.i}_${offset.j}`;
}

/**
 * Creates a simple PIXI texture sized to the canvas. The resolution scales based on size to handle large scenes.
 */
export function createPlainTexture() {
    const { width, height } = canvas.dimensions.sceneRect;
    const area = width * height;
    const resolution = area > 16000 ** 2 ? 0.25 : area > 8000 ** 2 ? 0.5 : 1.0;
    return PIXI.RenderTexture.create({ width, height, resolution });
}

/**
 * Calculate the partial opacity for GMs based on the player, GM, and partial opacities.
 * Compute the percentage of partial vs. non-partial, and reapply to the GM selected value.
 * Afterwards, average it with the previous value, weighing closer to the previous the lower the alpha (so that we don't lose too much visibility).
 */
export function calculateGmPartialOpacity({ opacityPlayer, opacityGM, opacityPartial }) {
    if (opacityPlayer === 0) return opacityPartial; // avoid divide by 0
    const partialRatio = opacityPartial / opacityPlayer;
    const newAlpha = partialRatio * opacityGM;
    return Math.min(opacityGM, opacityPartial * (1 - partialRatio) + newAlpha * partialRatio);
}
