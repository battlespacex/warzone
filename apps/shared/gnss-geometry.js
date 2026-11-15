// Geographic boundaries shared by raster delivery and operational compatibility rendering.
export function gnssBoundary(cell, sizeKm = 28) {
    if (Array.isArray(cell.polygon) && cell.polygon.length >= 3) return cell.polygon
        .map(p => ({ lat: Number(p.lat), lon: Number(p.lon) })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    const lat = Number(cell.lat), lon = Number(cell.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    const radius = Math.max(4000, sizeKm * 1000), longitudeScale = Math.max(111320 * Math.abs(Math.cos(lat * Math.PI / 180)), 1);
    return Array.from({ length: 6 }, (_, i) => {
        const angle = (60 * i - 30) * Math.PI / 180;
        return { lat: lat + Math.sin(angle) * radius / 111320, lon: lon + Math.cos(angle) * radius / longitudeScale };
    });
}

export function unwrapGnssPolygon(points) {
    const result = [];
    for (const p of points) {
        let lon = ((p.lon + 180) % 360 + 360) % 360 - 180;
        const previous = result.at(-1)?.lon;
        if (previous !== undefined) { while (lon - previous > 180) lon -= 360; while (lon - previous < -180) lon += 360; }
        result.push({ lon, lat: Math.max(-90, Math.min(90, p.lat)) });
    }
    return result;
}

export function gnssContains(points, lon, lat) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i], b = points[j];
        if ((a.lat > lat) !== (b.lat > lat) && lon < (b.lon - a.lon) * (lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside;
    }
    return inside;
}
