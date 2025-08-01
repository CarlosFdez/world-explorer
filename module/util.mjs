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

export function uniqBy(arr, fn) {
    const seen = new Set();
    return arr.reduce((result, entry) => {
        const key = fn(entry);
        if (!seen.has(key)) {
            seen.add(key);
            result.push(entry);
        }

        return result;
    }, []);
}

export function uniq(arr) {
    return uniqBy(arr, String);
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