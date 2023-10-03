export function getGridPositionFromPixels(x, y) {
    if (canvas.grid.grid instanceof HexagonalGrid) {
        let gridPosition = canvas.grid.grid.getGridPositionFromPixels(x, y);
        let pixels = canvas.grid.grid.getPixelsFromGridPosition(gridPosition[0], gridPosition[1]);
        let polygon = new PIXI.Polygon(canvas.grid.grid.getPolygon(pixels[0], pixels[1]));

        if (polygon.contains(x, y)) {
            return gridPosition;
        }

        let neighbors = canvas.grid.grid.getNeighbors(gridPosition[0], gridPosition[1]);
        for (const neighbor of neighbors) {
            let neighborPixels = canvas.grid.grid.getPixelsFromGridPosition(neighbor[0], neighbor[1]);
            let neighborPolygon = new PIXI.Polygon(canvas.grid.grid.getPolygon(neighborPixels[0], neighborPixels[1]));

            if (neighborPolygon.contains(x, y)) {
                return neighbor;
            }
        }

        return gridPosition;
    }

    return canvas.grid.grid.getGridPositionFromPixels(x, y);
}