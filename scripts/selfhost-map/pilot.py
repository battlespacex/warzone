#!/usr/bin/env python3
"""Build a small, static StratOps basemap and Cesium heightmap terrain pilot.

Requires Pillow (python -m pip install Pillow==11.3.0). No browser dependency.
The source downloads and output stay under .generated/selfhosted by default.
"""

import argparse
import io
import json
import math
import os
import struct
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / ".generated" / "selfhosted"
SOURCE = WORK / "source"
OUTPUT = WORK / "output"
MAP_VERSION = "v1"
TERRAIN_VERSION = "v1"
BOUNDS = {"west": 20, "south": 10, "east": 65, "north": 45}
MAP_MAX_ZOOM = 7
TERRAIN_MAX_ZOOM = 7
NATURAL_EARTH_RASTER = "https://naturalearth.s3.amazonaws.com/10m_raster/SR_LR.zip"
NATURAL_EARTH_LAND = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson"
TERRARIUM_ROOT = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium"


def fetch(url, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file() and target.stat().st_size:
        return target
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "StratOps-offline-pilot/1.0"})
            with urllib.request.urlopen(request, timeout=45) as response, target.open("wb") as output:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
            return target
        except (OSError, urllib.error.URLError):
            target.unlink(missing_ok=True)
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def prepare_sources():
    archive = fetch(NATURAL_EARTH_RASTER, SOURCE / "SR_LR.zip")
    fetch(NATURAL_EARTH_LAND, SOURCE / "ne_50m_land.geojson")
    tif = SOURCE / "SR_LR.tif"
    if not tif.exists():
        with zipfile.ZipFile(archive) as zip_file, zip_file.open("SR_LR.tif") as source, tif.open("wb") as output:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
    print(f"Prepared Natural Earth raster ({tif.stat().st_size:,} bytes) and land geometry")


def lon_to_x(lon, zoom):
    return int(math.floor((lon + 180) / 360 * (1 << zoom)))


def lat_to_y(lat, zoom):
    lat = max(-85.05112878, min(85.05112878, lat))
    rad = math.radians(lat)
    return int(math.floor((1 - math.asinh(math.tan(rad)) / math.pi) / 2 * (1 << zoom)))


def tile_coordinates(zoom):
    if zoom <= 2:
        return [(x, y) for y in range(1 << zoom) for x in range(1 << zoom)]
    x_min = lon_to_x(BOUNDS["west"], zoom)
    x_max = lon_to_x(BOUNDS["east"], zoom)
    y_min = lat_to_y(BOUNDS["north"], zoom)
    y_max = lat_to_y(BOUNDS["south"], zoom)
    return [(x, y) for y in range(y_min, y_max + 1) for x in range(x_min, x_max + 1)]


def ring_pixels(ring, width, height):
    return [((lon + 180) / 360 * width, (90 - lat) / 180 * height) for lon, lat, *_ in ring]


def land_mask(size):
    features = json.loads((SOURCE / "ne_50m_land.geojson").read_text(encoding="utf-8"))["features"]
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    for feature in features:
        geometry = feature["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        for polygon in polygons:
            for index, ring in enumerate(polygon):
                if len(ring) >= 3:
                    draw.polygon(ring_pixels(ring, *size), fill=255 if index == 0 else 0)
    return mask


def projected_tile(source, x, y, zoom):
    """Resample an equirectangular Natural Earth raster into one XYZ tile."""
    result = Image.new("L", (256, 256))
    width, height = source.size
    left = int(x / (1 << zoom) * width)
    right = int((x + 1) / (1 << zoom) * width)
    for row in range(256):
        mercator_y = (y + (row + 0.5) / 256) / (1 << zoom)
        latitude = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * mercator_y))))
        source_y = max(0, min(height - 1, int((90 - latitude) / 180 * height)))
        strip = source.crop((left, source_y, max(left + 1, right), source_y + 1))
        result.paste(strip.resize((256, 1), Image.Resampling.BILINEAR), (0, row))
    return result


def build_map():
    prepare_sources()
    source = Image.open(SOURCE / "SR_LR.tif").convert("L")
    mask = land_mask(source.size)
    base = OUTPUT / "map" / MAP_VERSION
    count = 0
    for zoom in range(MAP_MAX_ZOOM + 1):
        segment = "global" if zoom <= 2 else "pilot"
        for x, y in tile_coordinates(zoom):
            target = base / segment / str(zoom) / str(x) / f"{y}.jpg"
            target.parent.mkdir(parents=True, exist_ok=True)
            relief = projected_tile(source, x, y, zoom)
            land = projected_tile(mask, x, y, zoom)
            channels = [relief.point(lambda value, offset=offset: max(0, min(255, int(offset + (value - 206) * 0.58)))) for offset in (45, 51, 52)]
            land_image = Image.merge("RGB", channels)
            tile = Image.composite(land_image, Image.new("RGB", (256, 256), (18, 31, 39)), land)
            tile.save(target, "JPEG", quality=80, optimize=True, subsampling=0)
            count += 1
        print(f"Map level {zoom}: {len(tile_coordinates(zoom))} tiles")
    manifest = {
        "version": MAP_VERSION,
        "format": "xyz-jpeg",
        "tileSize": 256,
        "global": {"template": "global/{z}/{x}/{y}.jpg", "maximumLevel": 2},
        "pilot": {"template": "pilot/{z}/{x}/{y}.jpg", "minimumLevel": 3, "maximumLevel": MAP_MAX_ZOOM, "rectangle": BOUNDS},
        "sampleTile": "global/0/0/0.jpg",
        "attribution": "Natural Earth public domain",
    }
    (base / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Built {count} map tiles under {base}")


def terrarium_image(zoom, x, y):
    world = 1 << zoom
    x = x % world
    y = max(0, min(world - 1, y))
    target = SOURCE / "terrarium" / str(zoom) / str(x) / f"{y}.png"
    fetch(f"{TERRARIUM_ROOT}/{zoom}/{x}/{y}.png", target)
    return Image.open(target).convert("RGB")


def terrain_tile(zoom, x, y, child_mask):
    images = {
        (0, 0): terrarium_image(zoom, x, y),
        (1, 0): terrarium_image(zoom, x + 1, y),
        (0, 1): terrarium_image(zoom, x, y + 1),
        (1, 1): terrarium_image(zoom, x + 1, y + 1),
    }
    result = bytearray(65 * 65 * 2 + 2)
    for row in range(65):
        for column in range(65):
            east, px = divmod(column * 4, 256)
            south, py = divmod(row * 4, 256)
            red, green, blue = images[(east, south)].getpixel((px, py))
            height = max(0, (red * 256 + green + blue / 256) - 32768)
            encoded = max(0, min(65535, round((height + 1000) * 5)))
            struct.pack_into("<H", result, (row * 65 + column) * 2, encoded)
    result[-2] = child_mask
    result[-1] = 0  # no water effect; oceans are flattened to sea level
    return result


def build_terrain():
    base = OUTPUT / "terrain" / TERRAIN_VERSION
    available = []
    count = 0
    coordinates_by_level = [tile_coordinates(zoom) for zoom in range(TERRAIN_MAX_ZOOM + 1)]
    for zoom in range(TERRAIN_MAX_ZOOM + 1):
        coordinates = coordinates_by_level[zoom]
        children = set(coordinates_by_level[zoom + 1]) if zoom < TERRAIN_MAX_ZOOM else set()
        xs = [x for x, _ in coordinates]
        ys = [y for _, y in coordinates]
        # Cesium's layer.json availability uses TMS Y even with slippyMap URLs.
        world = 1 << zoom
        available.append([{"startX": min(xs), "startY": world - max(ys) - 1,
                           "endX": max(xs), "endY": world - min(ys) - 1}])
        for x, y in coordinates:
            target = base / str(zoom) / str(x) / f"{y}.terrain"
            target.parent.mkdir(parents=True, exist_ok=True)
            child_mask = sum(1 << (2 + dx - 2 * dy) for dx in range(2) for dy in range(2)
                             if (x * 2 + dx, y * 2 + dy) in children)
            target.write_bytes(terrain_tile(zoom, x, y, child_mask))
            count += 1
        print(f"Terrain level {zoom}: {len(coordinates)} tiles")
    layer = {
        "tilejson": "2.1.0", "name": "StratOps Middle East terrain pilot", "version": TERRAIN_VERSION,
        "format": "heightmap-1.0", "projection": "EPSG:3857", "scheme": "slippyMap",
        "tiles": ["{z}/{x}/{y}.terrain"], "minzoom": 0, "maxzoom": TERRAIN_MAX_ZOOM,
        "available": available,
        "attribution": "Mapzen Terrain Tiles; USGS SRTM/GMTED2010; NOAA ETOPO1",
    }
    (base / "layer.json").write_text(json.dumps(layer, indent=2) + "\n", encoding="utf-8")
    print(f"Built {count} terrain tiles under {base}")


def validate():
    map_base = OUTPUT / "map" / MAP_VERSION
    terrain_base = OUTPUT / "terrain" / TERRAIN_VERSION
    manifest = json.loads((map_base / "manifest.json").read_text(encoding="utf-8"))
    layer = json.loads((terrain_base / "layer.json").read_text(encoding="utf-8"))
    map_paths = list(map_base.rglob("*.jpg"))
    terrain_paths = list(terrain_base.rglob("*.terrain"))
    expected_map = sum(len(tile_coordinates(z)) for z in range(MAP_MAX_ZOOM + 1))
    expected_terrain = sum(len(tile_coordinates(z)) for z in range(TERRAIN_MAX_ZOOM + 1))
    assert len(map_paths) == expected_map, (len(map_paths), expected_map)
    assert len(terrain_paths) == expected_terrain, (len(terrain_paths), expected_terrain)
    assert len(layer["available"]) == TERRAIN_MAX_ZOOM + 1
    assert manifest["sampleTile"] == "global/0/0/0.jpg"
    with Image.open(map_base / manifest["sampleTile"]) as image:
        assert image.size == (256, 256)
    with Image.open(map_base / "pilot" / "5" / "19" / "13.jpg") as image:
        assert image.getextrema()[0][1] - image.getextrema()[0][0] > 15
    highest_encoded = 0
    for path in terrain_paths:
        assert path.stat().st_size == 65 * 65 * 2 + 2, path
        zoom, x, y = int(path.parts[-3]), int(path.parts[-2]), int(path.stem)
        children = set(tile_coordinates(zoom + 1)) if zoom < TERRAIN_MAX_ZOOM else set()
        expected_mask = sum(1 << (2 + dx - 2 * dy) for dx in range(2) for dy in range(2)
                            if (x * 2 + dx, y * 2 + dy) in children)
        content = path.read_bytes()
        assert content[-2] == expected_mask, path
        highest_encoded = max(highest_encoded, max(struct.unpack_from("<4225H", content)))
    assert highest_encoded / 5 - 1000 > 1000, "Pilot terrain lacks mountain elevations"
    map_bytes = sum(path.stat().st_size for path in map_paths)
    terrain_bytes = sum(path.stat().st_size for path in terrain_paths)
    print(json.dumps({"mapTiles": len(map_paths), "mapBytes": map_bytes,
                      "terrainTiles": len(terrain_paths), "terrainBytes": terrain_bytes,
                      "maximumTerrainMeters": round(highest_encoded / 5 - 1000),
                      "mapAverageBytes": round(map_bytes / len(map_paths)),
                      "terrainAverageBytes": round(terrain_bytes / len(terrain_paths))}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["download", "build-map", "build-terrain", "validate"])
    command = parser.parse_args().command
    {"download": prepare_sources, "build-map": build_map,
     "build-terrain": build_terrain, "validate": validate}[command]()


if __name__ == "__main__":
    main()
