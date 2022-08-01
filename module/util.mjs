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