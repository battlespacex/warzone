import { Cartesian3, Cartographic, Math as CesiumMath } from "cesium";

// Component-wise monotone Hermite interpolation in unwrapped geodetic space.
// Every observation is retained; each interval stays within its endpoint bounds.
// No camera state, heading, prediction or terrain exaggeration enters this curve.
export function curveObservedAircraftTrail(positions = []) {
    if (positions.length < 3) return positions;
    const points = positions.map(position => Cartographic.fromCartesian(position));
    if (points.some(point => !point)) return positions;
    for (let i = 1; i < points.length; i += 1) {
        points[i].longitude = points[i - 1].longitude + CesiumMath.negativePiToPi(
            points[i].longitude - points[i - 1].longitude
        );
    }
    const spans = positions.slice(1).map((point, i) => Math.max(0.01, Cartesian3.distance(positions[i], point)));
    const slopes = {};
    for (const axis of ["longitude", "latitude", "height"]) {
        const secants = spans.map((span, i) => (points[i + 1][axis] - points[i][axis]) / span);
        slopes[axis] = points.map((_point, i) => {
            if (i === 0) return secants[0];
            if (i === points.length - 1) return secants[i - 1];
            const before = secants[i - 1], after = secants[i];
            if (before * after <= 0) return 0;
            const w1 = 2 * spans[i] + spans[i - 1];
            const w2 = spans[i] + 2 * spans[i - 1];
            return (w1 + w2) / (w1 / before + w2 / after);
        });
    }
    const output = [positions[0]];
    // At most two intermediate vertices per observation interval (1798 for
    // the existing 600-point focused history limit). Sparse pairs stay straight.
    for (let i = 0; i < spans.length; i += 1) {
        for (let step = 1; step < 3; step += 1) {
            const t = step / 3, t2 = t * t, t3 = t2 * t;
            const point = {};
            for (const axis of ["longitude", "latitude", "height"]) {
                const a = points[i][axis], b = points[i + 1][axis];
                const value = (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * spans[i] * slopes[axis][i]
                    + (-2 * t3 + 3 * t2) * b + (t3 - t2) * spans[i] * slopes[axis][i + 1];
                point[axis] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), value));
            }
            output.push(Cartesian3.fromRadians(point.longitude, point.latitude, point.height));
        }
        output.push(positions[i + 1]);
    }
    return output;
}
