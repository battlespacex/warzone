#!/usr/bin/env python3
"""Build a small, static StratOps basemap and Cesium heightmap terrain pilot.

Requires Pillow (python -m pip install Pillow==11.3.0). No browser dependency.
The source downloads and output stay under .generated/selfhosted by default.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict
import functools
import io
import json
import math
import os
import shutil
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

from PIL import Image, ImageChops, ImageColor, ImageDraw, ImageFont, ImageStat

Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / ".generated" / "selfhosted"
SOURCE = WORK / "source"
OUTPUT = WORK / "output"
MAP_VERSION = "v1"
TACTICAL_MAP_VERSION = "v1"
TERRAIN_VERSION = "v1"
BOUNDS = {"west": 20, "south": 10, "east": 65, "north": 45}
MAP_MAX_ZOOM = 7
TACTICAL_TILE_SIZE = 512
TACTICAL_METATILE_SIZE = 4
TACTICAL_METATILE_BUFFER = 96
TACTICAL_GLOBAL_MAX_ZOOM = 4
TACTICAL_REGIONAL_MAX_ZOOM = 8
TACTICAL_CLOSE_MIN_ZOOM = 9
TACTICAL_CLOSE_MAX_ZOOM = 12
TACTICAL_DETAIL_ZOOM = 13
TACTICAL_MAX_ZOOM = TACTICAL_DETAIL_ZOOM
TACTICAL_CLOSE_BOUNDS = {"west": 53.8, "south": 23.8, "east": 56.4, "north": 26.1}
TACTICAL_DETAIL_AREAS = [
    {"name": "dubai", "rectangle": {"west": 54.9, "south": 24.8, "east": 55.7, "north": 25.55}},
    {"name": "abu-dhabi", "rectangle": {"west": 54.1, "south": 24.15, "east": 54.9, "north": 24.75}},
]
TACTICAL_EXTENSION = "webp"
TACTICAL_FORMAT = "WEBP"
TACTICAL_WEBP_QUALITY = 90
TERRAIN_MAX_ZOOM = 7
NATURAL_EARTH_RASTER = "https://naturalearth.s3.amazonaws.com/10m_raster/SR_LR.zip"
NATURAL_EARTH_LAND = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson"
TERRARIUM_ROOT = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium"
TACTICAL_STYLE = Path(__file__).with_name("tactical-style.json")
MAPLIBRE_STYLE = Path(__file__).with_name("maplibre") / "tactical-v1.style.json"
TACTICAL_SOURCES = {
    "land": NATURAL_EARTH_LAND,
    "lakes": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_lakes.geojson",
    "countries": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
    "states": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson",
    "roads": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_roads.geojson",
    "cities": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_populated_places.geojson",
    "airports": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_airports.geojson",
}
OSM_UAE_BOUNDS = (22.0, 51.0, 27.0, 57.0)
OSM_OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OSM_UAE_QUERY = """[out:json][timeout:180];(
way[\"highway\"~\"^(motorway|trunk|primary|secondary)$\"](22.0,51.0,27.0,57.0);
node[\"place\"~\"^(city|town)$\"](22.0,51.0,27.0,57.0);
nwr[\"aeroway\"=\"aerodrome\"](22.0,51.0,27.0,57.0);
way[\"natural\"=\"coastline\"](22.0,51.0,27.0,57.0);
way[\"natural\"=\"water\"](22.0,51.0,27.0,57.0);
way[\"boundary\"=\"administrative\"][\"admin_level\"~\"^(2|4)$\"](22.0,51.0,27.0,57.0);
);out tags geom;"""


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


def prepare_tactical_sources():
    for name, url in TACTICAL_SOURCES.items():
        fetch(url, tactical_source_path(name))
    osm_target = SOURCE / "tactical" / "osm-uae.json"
    if not osm_target.is_file() or not osm_target.stat().st_size:
        osm_target.parent.mkdir(parents=True, exist_ok=True)
        payload = urllib.parse.urlencode({"data": OSM_UAE_QUERY}).encode("utf-8")
        request = urllib.request.Request(OSM_OVERPASS_URL, data=payload, headers={
            "User-Agent": "StratOps-offline-pilot/1.0",
            "Content-Type": "application/x-www-form-urlencoded",
        })
        with urllib.request.urlopen(request, timeout=240) as response, osm_target.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
    print("Prepared Natural Earth and bounded UAE OpenStreetMap tactical sources")


def tactical_tile_coordinates(zoom):
    if zoom <= TACTICAL_GLOBAL_MAX_ZOOM:
        return [(x, y) for y in range(1 << zoom) for x in range(1 << zoom)]

    def coordinates_for_bounds(bounds):
        world = 1 << zoom
        x_min = max(0, min(world - 1, lon_to_x(bounds["west"], zoom)))
        x_max = max(0, min(world - 1, lon_to_x(bounds["east"], zoom)))
        y_min = max(0, min(world - 1, lat_to_y(bounds["north"], zoom)))
        y_max = max(0, min(world - 1, lat_to_y(bounds["south"], zoom)))
        return {(x, y) for y in range(y_min, y_max + 1) for x in range(x_min, x_max + 1)}

    if zoom == TACTICAL_DETAIL_ZOOM:
        return sorted(set().union(*(coordinates_for_bounds(area["rectangle"]) for area in TACTICAL_DETAIL_AREAS)),
                      key=lambda coordinate: (coordinate[1], coordinate[0]))
    bounds = TACTICAL_CLOSE_BOUNDS if zoom >= TACTICAL_CLOSE_MIN_ZOOM else BOUNDS
    return sorted(coordinates_for_bounds(bounds), key=lambda coordinate: (coordinate[1], coordinate[0]))


def rgba(token, tokens, opacity_token=None):
    red, green, blue = ImageColor.getrgb(tokens[token])
    opacity = float(tokens.get(opacity_token, 1)) if opacity_token else 1
    return red, green, blue, round(max(0, min(1, opacity)) * 255)


def iter_geometry_lines(geometry):
    if not geometry:
        return
    kind = geometry.get("type")
    coordinates = geometry.get("coordinates") or []
    if kind == "LineString":
        yield coordinates
    elif kind == "MultiLineString":
        yield from coordinates
    elif kind == "Polygon":
        yield from coordinates
    elif kind == "MultiPolygon":
        for polygon in coordinates:
            yield from polygon


def geometry_points(geometry):
    for line in iter_geometry_lines(geometry) or []:
        for point in line:
            if len(point) >= 2:
                yield float(point[0]), float(point[1])


def tactical_source_path(name):
    filename = "land-10m.geojson" if name == "land" else f"{name}.geojson"
    return SOURCE / "tactical" / filename


def feature_records(name):
    data = json.loads(tactical_source_path(name).read_text(encoding="utf-8"))
    records = []
    for feature in data.get("features", []):
        geometry = feature.get("geometry") or {}
        points = list(geometry_points(geometry))
        if geometry.get("type") == "Point":
            coordinates = geometry.get("coordinates") or []
            if len(coordinates) >= 2:
                points = [(float(coordinates[0]), float(coordinates[1]))]
        if not points:
            continue
        lons = [point[0] for point in points]
        lats = [point[1] for point in points]
        records.append((geometry, feature.get("properties") or {}, (min(lons), min(lats), max(lons), max(lats))))
    return records


def osm_feature_records():
    payload = json.loads((SOURCE / "tactical" / "osm-uae.json").read_text(encoding="utf-8"))
    records = {name: [] for name in ("roads", "cities", "airports", "coastlines", "waters", "boundaries")}
    for element in payload.get("elements", []):
        tags = element.get("tags") or {}
        geometry_points_raw = element.get("geometry") or []
        if element.get("type") == "node":
            try:
                coordinates = [float(element["lon"]), float(element["lat"])]
            except (KeyError, TypeError, ValueError):
                continue
            geometry = {"type": "Point", "coordinates": coordinates}
            points = [tuple(coordinates)]
        else:
            points = [(float(point["lon"]), float(point["lat"])) for point in geometry_points_raw
                      if "lon" in point and "lat" in point]
            if len(points) < 2:
                continue
            closed = len(points) >= 4 and points[0] == points[-1]
            geometry = {"type": "Polygon" if closed and (tags.get("natural") == "water" or tags.get("area") == "yes")
                        else "LineString", "coordinates": [points] if closed and (tags.get("natural") == "water" or tags.get("area") == "yes") else points}
        lons = [point[0] for point in points]
        lats = [point[1] for point in points]
        properties = {**tags, "osm_id": element.get("id"), "osm_type": element.get("type")}
        properties["_label_point"] = [(min(lons) + max(lons)) / 2, (min(lats) + max(lats)) / 2]
        record = (geometry, properties, (min(lons), min(lats), max(lons), max(lats)))
        if tags.get("highway") in {"motorway", "trunk", "primary", "secondary"}:
            records["roads"].append(record)
        if tags.get("place") in {"city", "town"}:
            records["cities"].append(record)
        if tags.get("aeroway") == "aerodrome":
            records["airports"].append(record)
        if tags.get("natural") == "coastline":
            records["coastlines"].append(record)
        if tags.get("natural") == "water":
            records["waters"].append(record)
        if tags.get("boundary") == "administrative" and tags.get("admin_level") in {"2", "4"}:
            records["boundaries"].append(record)
    return records


def tile_lonlat_bounds(zoom, x, y):
    world = 1 << zoom
    west = x / world * 360 - 180
    east = (x + 1) / world * 360 - 180
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / world))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / world))))
    return west, south, east, north


def intersects(bounds, tile_bounds, pad=1.0):
    west, south, east, north = tile_bounds
    return not (bounds[2] < west - pad or bounds[0] > east + pad or
                bounds[3] < south - pad or bounds[1] > north + pad)


def project_point(lon, lat, zoom, tile_x, tile_y, tile_size=256, offset=0):
    world_pixels = (1 << zoom) * tile_size
    px = (lon + 180) / 360 * world_pixels - tile_x * tile_size + offset
    lat = max(-85.05112878, min(85.05112878, lat))
    py = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * world_pixels - tile_y * tile_size + offset
    return px, py


def index_records_for_tiles(records, zoom, coordinates):
    allowed = set(coordinates)
    index = {coordinate: [] for coordinate in coordinates}
    world = 1 << zoom
    for record in records:
        west, south, east, north = record[2]
        x_min = max(0, min(world - 1, lon_to_x(west, zoom)))
        x_max = max(0, min(world - 1, lon_to_x(east, zoom)))
        y_min = max(0, min(world - 1, lat_to_y(north, zoom)))
        y_max = max(0, min(world - 1, lat_to_y(south, zoom)))
        for tile_y in range(y_min, y_max + 1):
            for tile_x in range(x_min, x_max + 1):
                coordinate = (tile_x, tile_y)
                if coordinate in allowed:
                    index[coordinate].append(record)
    return index


def draw_geometry(draw, geometry, zoom, tile_x, tile_y, fill, width, tile_size=256, offset=0):
    for line in iter_geometry_lines(geometry) or []:
        points = [project_point(point[0], point[1], zoom, tile_x, tile_y, tile_size, offset)
                  for point in line if len(point) >= 2]
        if len(points) >= 2:
            draw.line(points, fill=fill, width=max(1, round(width)), joint="curve")


def draw_geometry_fill(draw, geometry, zoom, tile_x, tile_y, fill, tile_size=256, offset=0):
    kind = geometry.get("type")
    coordinates = geometry.get("coordinates") or []
    polygons = [coordinates] if kind == "Polygon" else coordinates if kind == "MultiPolygon" else []
    for polygon in polygons:
        for index, ring in enumerate(polygon):
            points = [project_point(point[0], point[1], zoom, tile_x, tile_y, tile_size, offset)
                      for point in ring if len(point) >= 2]
            if len(points) >= 3 and index == 0:
                draw.polygon(points, fill=fill)


@functools.lru_cache(maxsize=16)
def tactical_font(size, bold=False):
    candidates = [
        Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / ("arialbd.ttf" if bold else "arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def label_point(properties, geometry):
    if properties.get("_label_point"):
        return tuple(properties["_label_point"])
    for lon_key, lat_key in (("LABEL_X", "LABEL_Y"), ("LONGITUDE", "LATITUDE"), ("longitude", "latitude")):
        try:
            return float(properties[lon_key]), float(properties[lat_key])
        except (KeyError, TypeError, ValueError):
            pass
    coordinates = geometry.get("coordinates") or []
    if geometry.get("type") == "Point" and len(coordinates) >= 2:
        return float(coordinates[0]), float(coordinates[1])
    return None


def property_rank(properties, fallback=99):
    for key in ("SCALERANK", "LABELRANK", "scalerank", "rank"):
        try:
            return int(float(properties[key]))
        except (KeyError, TypeError, ValueError):
            pass
    return fallback


def draw_label(image, occupied, text, point, zoom, tile_x, tile_y, font, color, halo, halo_width,
               tile_size=256, offset=0, safe_bounds=None):
    if not text or not point:
        return
    x, y = project_point(point[0], point[1], zoom, tile_x, tile_y, tile_size, offset)
    if x < 0 or x > image.width or y < 0 or y > image.height:
        return
    draw = ImageDraw.Draw(image)
    box = draw.textbbox((x, y), text, font=font, anchor="mm", stroke_width=halo_width)
    if safe_bounds and (box[0] < safe_bounds[0] or box[1] < safe_bounds[1] or
                        box[2] > safe_bounds[2] or box[3] > safe_bounds[3]):
        return
    if any(not (box[2] < old[0] or box[0] > old[2] or box[3] < old[1] or box[1] > old[3]) for old in occupied):
        return
    occupied.append(box)
    draw.text((x, y), text, font=font, anchor="mm", fill=color, stroke_fill=halo,
              stroke_width=halo_width)


def load_tactical_data():
    prepare_tactical_sources()
    return {
        "natural": {name: feature_records(name) for name in TACTICAL_SOURCES},
        "osm": osm_feature_records(),
    }


def record_center_in_bounds(record, bounds):
    west, south, east, north = record[2]
    lon, lat = (west + east) / 2, (south + north) / 2
    return bounds["west"] <= lon <= bounds["east"] and bounds["south"] <= lat <= bounds["north"]


def tactical_data_for_zoom(zoom, data):
    natural, osm = data["natural"], data["osm"]
    use_osm = zoom >= 6
    close = zoom >= TACTICAL_CLOSE_MIN_ZOOM
    cities = [] if close else list(natural["cities"])
    airports = [] if close else list(natural["airports"])
    if use_osm:
        cities = [record for record in cities if not record_center_in_bounds(record, TACTICAL_CLOSE_BOUNDS)] + osm["cities"]
        airports = [record for record in airports if not record_center_in_bounds(record, TACTICAL_CLOSE_BOUNDS)] + osm["airports"]
    return {
        "land": natural["land"],
        "lakes": natural["lakes"],
        "countries": natural["countries"],
        "states": natural["states"],
        "roads": ([] if close else list(natural["roads"])) + (osm["roads"] if use_osm else []),
        "cities": cities,
        "airports": airports,
        "coastlines": osm["coastlines"] if use_osm else [],
        "waters": osm["waters"] if use_osm else [],
        "boundaries": osm["boundaries"] if use_osm else [],
    }


def label_priority(properties):
    place = properties.get("place")
    if place == "city":
        try:
            return -int(properties.get("population", 0))
        except (TypeError, ValueError):
            return 0
    if place == "town":
        return 1_000_000
    return property_rank(properties)


def feature_name(properties):
    for key in ("name:en", "int_name", "NAME", "NAMEPAR", "ADMIN", "name"):
        value = str(properties.get(key) or "").strip()
        if value and (key != "name" or value.isascii()):
            return value.upper()
    return ""


def metatile_records(indexed, coordinates):
    result = {}
    for name, entries in indexed.items():
        seen = set()
        selected = []
        for coordinate in coordinates:
            for record in entries.get(coordinate, []):
                marker = id(record)
                if marker not in seen:
                    seen.add(marker)
                    selected.append(record)
        result[name] = selected
    return result


def render_tactical_metatile(zoom, tile_x, tile_y, tile_columns, tile_rows, tokens, data):
    size = (tile_columns * TACTICAL_TILE_SIZE + TACTICAL_METATILE_BUFFER * 2,
            tile_rows * TACTICAL_TILE_SIZE + TACTICAL_METATILE_BUFFER * 2)
    image = Image.new("RGBA", size, rgba("OCEAN_FILL", tokens, "OCEAN_FILL_OPACITY"))
    draw = ImageDraw.Draw(image)
    project = (TACTICAL_TILE_SIZE, TACTICAL_METATILE_BUFFER)
    for geometry, _properties, _bbox in data["land"]:
        draw_geometry_fill(draw, geometry, zoom, tile_x, tile_y,
                           rgba("LAND_FILL", tokens, "LAND_FILL_OPACITY"), *project)
    for geometry, _properties, _bbox in data["lakes"] + data["waters"]:
        draw_geometry_fill(draw, geometry, zoom, tile_x, tile_y,
                           rgba("WATER_FILL", tokens, "WATER_FILL_OPACITY"), *project)
    for geometry, _properties, _bbox in data["land"] + data["coastlines"]:
        draw_geometry(draw, geometry, zoom, tile_x, tile_y,
                      rgba("COASTLINE", tokens, "COASTLINE_OPACITY"), tokens["COASTLINE_WIDTH"], *project)
    for geometry, _properties, _bbox in data["countries"]:
        draw_geometry(draw, geometry, zoom, tile_x, tile_y,
                      rgba("COUNTRY_BORDER", tokens, "COUNTRY_BORDER_OPACITY"), tokens["COUNTRY_BORDER_WIDTH"], *project)
    if zoom >= 4:
        for geometry, _properties, _bbox in data["states"] + data["boundaries"]:
            draw_geometry(draw, geometry, zoom, tile_x, tile_y,
                          rgba("STATE_BORDER", tokens, "STATE_BORDER_OPACITY"), tokens["STATE_BORDER_WIDTH"], *project)
    if zoom >= 4:
        for geometry, properties, _bbox in data["roads"]:
            highway = properties.get("highway")
            if highway:
                if zoom < 7 and highway not in {"motorway", "trunk"}:
                    continue
                if zoom < 9 and highway == "secondary":
                    continue
                primary = highway in {"motorway", "trunk", "primary"}
            else:
                rank = property_rank(properties)
                if rank > (4 if zoom < 7 else 8):
                    continue
                primary = rank <= 4
            prefix = "PRIMARY_ROAD" if primary else "SECONDARY_ROAD"
            draw_geometry(draw, geometry, zoom, tile_x, tile_y,
                          rgba(prefix, tokens, f"{prefix}_OPACITY"), tokens[f"{prefix}_WIDTH"], *project)

    occupied = []
    safe_bounds = (TACTICAL_METATILE_BUFFER, TACTICAL_METATILE_BUFFER,
                   TACTICAL_METATILE_BUFFER + tile_columns * TACTICAL_TILE_SIZE,
                   TACTICAL_METATILE_BUFFER + tile_rows * TACTICAL_TILE_SIZE)
    if zoom <= 6:
        country_rank = 2 if zoom <= 2 else 5
        for geometry, properties, _bbox in sorted(data["countries"], key=lambda record: property_rank(record[1])):
            if property_rank(properties) > country_rank:
                continue
            name = feature_name(properties)
            draw_label(image, occupied, name, label_point(properties, geometry), zoom, tile_x, tile_y,
                       tactical_font(int(tokens["COUNTRY_LABEL_SIZE"]), True),
                       rgba("COUNTRY_LABEL", tokens, "COUNTRY_LABEL_OPACITY"), tokens["COUNTRY_LABEL_HALO"],
                       int(tokens["COUNTRY_LABEL_HALO_WIDTH"]), *project, safe_bounds)
    city_rank = 2 if zoom <= 2 else 4 if zoom <= 4 else 6 if zoom <= 6 else 8
    for geometry, properties, _bbox in sorted(data["cities"], key=lambda record: (label_priority(record[1]), str(record[1].get("name", "")))):
        if properties.get("place") == "town" and zoom < 9:
            continue
        if not properties.get("place") and property_rank(properties) > city_rank:
            continue
        name = feature_name(properties)
        if not name:
            continue
        draw_label(image, occupied, name, label_point(properties, geometry), zoom, tile_x, tile_y,
                   tactical_font(int(tokens["CITY_LABEL_SIZE"]), properties.get("place") == "city"),
                   rgba("CITY_LABEL", tokens, "CITY_LABEL_OPACITY"), tokens["CITY_LABEL_HALO"],
                   int(tokens["CITY_LABEL_HALO_WIDTH"]), *project, safe_bounds)
    if zoom >= 5:
        for geometry, properties, _bbox in data["airports"]:
            if not properties.get("aeroway") and property_rank(properties, 5) > 6:
                continue
            point = label_point(properties, geometry)
            if not point:
                continue
            px, py = project_point(point[0], point[1], zoom, tile_x, tile_y, *project)
            if safe_bounds[0] <= px <= safe_bounds[2] and safe_bounds[1] <= py <= safe_bounds[3]:
                radius = int(tokens["AIRPORT_RADIUS"])
                color = rgba("AIRPORT_COLOR", tokens, "AIRPORT_OPACITY")
                draw.ellipse((px - radius, py - radius, px + radius, py + radius), outline=color, width=2)
    return image.convert("RGB")


def save_tactical_tile(tile, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    tile.save(target, TACTICAL_FORMAT, quality=TACTICAL_WEBP_QUALITY, method=2, exact=True)


def render_and_save_tactical_metatile(zoom, meta_x, meta_y, selected_coordinates, targets, tokens, render_data,
                                      resume):
    image = render_tactical_metatile(zoom, meta_x, meta_y, TACTICAL_METATILE_SIZE,
                                     TACTICAL_METATILE_SIZE, tokens, render_data)
    written = 0
    for x, y in selected_coordinates:
        target = targets[(x, y)]
        if resume and target.is_file():
            written += 1
            continue
        left = TACTICAL_METATILE_BUFFER + (x - meta_x) * TACTICAL_TILE_SIZE
        top = TACTICAL_METATILE_BUFFER + (y - meta_y) * TACTICAL_TILE_SIZE
        tile = image.crop((left, top, left + TACTICAL_TILE_SIZE, top + TACTICAL_TILE_SIZE))
        save_tactical_tile(tile, target)
        written += 1
    return written


def build_tactical_map():
    data = load_tactical_data()
    tokens = json.loads(TACTICAL_STYLE.read_text(encoding="utf-8"))["tokens"]
    base = OUTPUT / "map" / "tactical" / TACTICAL_MAP_VERSION
    tactical_root = (OUTPUT / "map" / "tactical").resolve()
    resume = os.environ.get("STRATOPS_TACTICAL_RESUME") == "1"
    rebuild_from_zoom = int(os.environ.get("STRATOPS_TACTICAL_REBUILD_FROM_ZOOM", TACTICAL_MAX_ZOOM + 1))
    rebuild_close_labels_only = os.environ.get("STRATOPS_TACTICAL_REBUILD_CLOSE_LABELS") == "1"
    close_bounds_tuple = tuple(TACTICAL_CLOSE_BOUNDS[key] for key in ("west", "south", "east", "north"))
    if base.exists() and not resume and base.resolve().is_relative_to(tactical_root):
        shutil.rmtree(base)
    count = 0
    workers = ThreadPoolExecutor(max_workers=max(2, min(4, os.cpu_count() or 2)))
    for zoom in range(TACTICAL_MAX_ZOOM + 1):
        coordinates = tactical_tile_coordinates(zoom)
        allowed = set(coordinates)
        zoom_data = tactical_data_for_zoom(zoom, data)
        indexed = {name: index_records_for_tiles(records, zoom, coordinates) for name, records in zoom_data.items()}
        groups = defaultdict(list)
        for coordinate in coordinates:
            groups[(coordinate[0] // TACTICAL_METATILE_SIZE * TACTICAL_METATILE_SIZE,
                    coordinate[1] // TACTICAL_METATILE_SIZE * TACTICAL_METATILE_SIZE)].append(coordinate)
        segment = ("global" if zoom <= TACTICAL_GLOBAL_MAX_ZOOM else
                   "pilot" if zoom <= TACTICAL_REGIONAL_MAX_ZOOM else
                   "close" if zoom <= TACTICAL_CLOSE_MAX_ZOOM else "detail")
        pending = []
        for (meta_x, meta_y), selected_coordinates in groups.items():
            force_rebuild = zoom >= rebuild_from_zoom
            if force_rebuild and rebuild_close_labels_only and zoom < TACTICAL_CLOSE_MIN_ZOOM:
                force_rebuild = any(intersects(close_bounds_tuple, tile_lonlat_bounds(zoom, x, y), pad=0)
                                    for x, y in selected_coordinates)
            targets = {
                (x, y): base / segment / str(zoom) / str(x) / f"{y}.{TACTICAL_EXTENSION}"
                for x, y in selected_coordinates
            }
            if resume and not force_rebuild and all(target.is_file() for target in targets.values()):
                count += len(selected_coordinates)
                continue
            relevant_coordinates = [(x, y) for y in range(meta_y, meta_y + TACTICAL_METATILE_SIZE)
                                    for x in range(meta_x, meta_x + TACTICAL_METATILE_SIZE) if (x, y) in allowed]
            render_data = metatile_records(indexed, relevant_coordinates)
            pending.append(workers.submit(render_and_save_tactical_metatile, zoom, meta_x, meta_y,
                                          selected_coordinates, targets, tokens, render_data,
                                          resume and not force_rebuild))
        for future in pending:
            count += future.result()
        print(f"Tactical level {zoom}: {len(coordinates)} tiles, {len(groups)} metatiles")
    workers.shutdown(wait=True)
    manifest = {
        "version": TACTICAL_MAP_VERSION,
        "kind": "tactical",
        "format": "xyz-webp",
        "tileSize": TACTICAL_TILE_SIZE,
        "global": {"template": f"global/{{z}}/{{x}}/{{y}}.{TACTICAL_EXTENSION}", "maximumLevel": TACTICAL_GLOBAL_MAX_ZOOM},
        "pilot": {"template": f"pilot/{{z}}/{{x}}/{{y}}.{TACTICAL_EXTENSION}",
                  "minimumLevel": TACTICAL_GLOBAL_MAX_ZOOM + 1, "maximumLevel": TACTICAL_REGIONAL_MAX_ZOOM,
                  "rectangle": BOUNDS},
        "close": {"template": f"close/{{z}}/{{x}}/{{y}}.{TACTICAL_EXTENSION}",
                  "minimumLevel": TACTICAL_CLOSE_MIN_ZOOM, "maximumLevel": TACTICAL_CLOSE_MAX_ZOOM,
                  "rectangle": TACTICAL_CLOSE_BOUNDS},
        "detail": [{"name": area["name"], "template": f"detail/{{z}}/{{x}}/{{y}}.{TACTICAL_EXTENSION}",
                    "minimumLevel": TACTICAL_DETAIL_ZOOM, "maximumLevel": TACTICAL_DETAIL_ZOOM,
                    "minimumTerrainLevel": 14, "rectangle": area["rectangle"]}
                   for area in TACTICAL_DETAIL_AREAS],
        "sampleTile": f"global/0/0/0.{TACTICAL_EXTENSION}",
        "styleTokens": "scripts/selfhost-map/tactical-style.json",
        "attribution": "Natural Earth (public domain); (c) OpenStreetMap contributors (ODbL)",
    }
    (base / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Built {count} tactical tiles under {base}")


def export_maplibre_style():
    style = json.loads(MAPLIBRE_STYLE.read_text(encoding="utf-8"))
    tokens = json.loads(TACTICAL_STYLE.read_text(encoding="utf-8"))["tokens"]
    paint = {layer["id"]: layer.setdefault("paint", {}) for layer in style["layers"]}
    paint["background"]["background-color"] = tokens["BACKGROUND"]
    paint["water"].update({"fill-color": tokens["WATER_FILL"], "fill-opacity": tokens["WATER_FILL_OPACITY"]})
    paint["landcover"].update({"fill-color": tokens["LAND_FILL"], "fill-opacity": tokens["LAND_FILL_OPACITY"]})
    for layer_id, prefix in (("country-boundary", "COUNTRY_BORDER"), ("state-boundary", "STATE_BORDER"),
                             ("primary-road", "PRIMARY_ROAD"), ("secondary-road", "SECONDARY_ROAD")):
        paint[layer_id].update({"line-color": tokens[prefix], "line-opacity": tokens[f"{prefix}_OPACITY"],
                                "line-width": tokens[f"{prefix}_WIDTH"]})
    paint["airport"].update({"circle-color": tokens["AIRPORT_COLOR"], "circle-opacity": tokens["AIRPORT_OPACITY"]})
    for layer_id, prefix in (("country-label", "COUNTRY_LABEL"), ("city-label", "CITY_LABEL")):
        paint[layer_id].update({"text-color": tokens[prefix], "text-opacity": tokens[f"{prefix}_OPACITY"],
                                "text-halo-color": tokens[f"{prefix}_HALO"],
                                "text-halo-width": tokens[f"{prefix}_HALO_WIDTH"]})
    MAPLIBRE_STYLE.write_text(json.dumps(style, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {MAPLIBRE_STYLE} from tactical tokens")


def benchmark_formats():
    base = OUTPUT / "map" / "tactical" / TACTICAL_MAP_VERSION
    sample_x, sample_y = lon_to_x(55.2708, 10), lat_to_y(25.2048, 10)
    sample = base / "close" / "10" / str(sample_x) / f"{sample_y}.{TACTICAL_EXTENSION}"
    if not sample.is_file():
        sample = base / "global" / "0" / "0" / f"0.{TACTICAL_EXTENSION}"
    image = Image.open(sample).convert("RGB")
    output = WORK / "format-benchmark"
    output.mkdir(parents=True, exist_ok=True)
    results = {}
    formats = {
        "jpeg-512-q94": (image, "JPEG", "jpg", {"quality": 94, "optimize": True, "subsampling": 0}),
        "webp-512-q90": (image, "WEBP", "webp", {"quality": 90, "method": 4, "exact": True}),
        "jpeg-256-q94": (image.resize((256, 256), Image.Resampling.LANCZOS), "JPEG", "jpg",
                           {"quality": 94, "optimize": True, "subsampling": 0}),
        "webp-256-q90": (image.resize((256, 256), Image.Resampling.LANCZOS), "WEBP", "webp",
                           {"quality": 90, "method": 4, "exact": True}),
    }
    for name, (candidate, image_format, extension, options) in formats.items():
        target = output / f"{name}.{extension}"
        candidate.save(target, image_format, **options)
        started = time.perf_counter()
        for _ in range(30):
            with Image.open(target) as decoded:
                decoded.load()
        with Image.open(target) as decoded:
            comparison = decoded.convert("RGB").resize(image.size, Image.Resampling.LANCZOS)
        difference = ImageChops.difference(image, comparison)
        mean_error = sum(ImageStat.Stat(difference).mean) / 3
        results[name] = {"bytes": target.stat().st_size,
                         "averageDecodeMs": round((time.perf_counter() - started) * 1000 / 30, 3),
                         "meanAbsoluteError": round(mean_error, 3)}
    (output / "results.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(results, indent=2))


def validate_tactical():
    tactical_base = OUTPUT / "map" / "tactical" / TACTICAL_MAP_VERSION
    manifest = json.loads((tactical_base / "manifest.json").read_text(encoding="utf-8"))
    paths = list(tactical_base.rglob(f"*.{TACTICAL_EXTENSION}"))
    expected = sum(len(tactical_tile_coordinates(z)) for z in range(TACTICAL_MAX_ZOOM + 1))
    assert manifest["kind"] == "tactical"
    assert manifest["format"] == "xyz-webp"
    assert manifest["global"]["maximumLevel"] == TACTICAL_GLOBAL_MAX_ZOOM
    assert manifest["pilot"]["maximumLevel"] == TACTICAL_REGIONAL_MAX_ZOOM
    assert manifest["close"]["minimumLevel"] == TACTICAL_CLOSE_MIN_ZOOM
    assert manifest["close"]["maximumLevel"] == TACTICAL_CLOSE_MAX_ZOOM
    assert len(manifest["detail"]) == len(TACTICAL_DETAIL_AREAS)
    assert all(area["minimumLevel"] == TACTICAL_DETAIL_ZOOM and
               area["maximumLevel"] == TACTICAL_DETAIL_ZOOM for area in manifest["detail"])
    assert len(paths) == expected, (len(paths), expected)
    with Image.open(tactical_base / manifest["sampleTile"]) as image:
        assert image.size == (TACTICAL_TILE_SIZE, TACTICAL_TILE_SIZE)
    total_bytes = sum(path.stat().st_size for path in paths)
    result = {"tacticalTiles": len(paths), "tacticalBytes": total_bytes,
              "tacticalAverageBytes": round(total_bytes / len(paths))}
    print(json.dumps(result, indent=2))
    return result


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
    tactical_base = OUTPUT / "map" / "tactical" / TACTICAL_MAP_VERSION
    terrain_base = OUTPUT / "terrain" / TERRAIN_VERSION
    manifest = json.loads((map_base / "manifest.json").read_text(encoding="utf-8"))
    tactical_manifest = json.loads((tactical_base / "manifest.json").read_text(encoding="utf-8"))
    layer = json.loads((terrain_base / "layer.json").read_text(encoding="utf-8"))
    map_paths = list(map_base.rglob("*.jpg"))
    tactical_paths = list(tactical_base.rglob(f"*.{TACTICAL_EXTENSION}"))
    terrain_paths = list(terrain_base.rglob("*.terrain"))
    expected_map = sum(len(tile_coordinates(z)) for z in range(MAP_MAX_ZOOM + 1))
    expected_tactical = sum(len(tactical_tile_coordinates(z)) for z in range(TACTICAL_MAX_ZOOM + 1))
    expected_terrain = sum(len(tile_coordinates(z)) for z in range(TERRAIN_MAX_ZOOM + 1))
    assert len(map_paths) == expected_map, (len(map_paths), expected_map)
    assert len(tactical_paths) == expected_tactical, (len(tactical_paths), expected_tactical)
    assert len(terrain_paths) == expected_terrain, (len(terrain_paths), expected_terrain)
    assert len(layer["available"]) == TERRAIN_MAX_ZOOM + 1
    assert manifest["sampleTile"] == "global/0/0/0.jpg"
    assert tactical_manifest["sampleTile"] == f"global/0/0/0.{TACTICAL_EXTENSION}"
    with Image.open(map_base / manifest["sampleTile"]) as image:
        assert image.size == (256, 256)
    with Image.open(map_base / "pilot" / "5" / "19" / "13.jpg") as image:
        assert image.getextrema()[0][1] - image.getextrema()[0][0] > 15
    with Image.open(tactical_base / tactical_manifest["sampleTile"]) as image:
        assert image.size == (TACTICAL_TILE_SIZE, TACTICAL_TILE_SIZE)
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
    tactical_bytes = sum(path.stat().st_size for path in tactical_paths)
    terrain_bytes = sum(path.stat().st_size for path in terrain_paths)
    print(json.dumps({"mapTiles": len(map_paths), "mapBytes": map_bytes,
                      "tacticalTiles": len(tactical_paths), "tacticalBytes": tactical_bytes,
                      "terrainTiles": len(terrain_paths), "terrainBytes": terrain_bytes,
                      "maximumTerrainMeters": round(highest_encoded / 5 - 1000),
                      "mapAverageBytes": round(map_bytes / len(map_paths)),
                      "terrainAverageBytes": round(terrain_bytes / len(terrain_paths))}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["download", "download-tactical", "build-map", "build-tactical",
                                            "build-terrain", "export-style", "benchmark-formats",
                                            "validate-tactical", "validate"])
    command = parser.parse_args().command
    {"download": prepare_sources, "download-tactical": prepare_tactical_sources,
     "build-map": build_map, "build-tactical": build_tactical_map,
     "build-terrain": build_terrain, "export-style": export_maplibre_style,
     "benchmark-formats": benchmark_formats, "validate-tactical": validate_tactical,
     "validate": validate}[command]()


if __name__ == "__main__":
    main()
