import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';
import * as C from 'cesium';
import vm from 'node:vm';
import { readGlbSizing, applyGlbDistanceSizing } from '../../../dev/assets/js/warzone-glb-distance-sizing.js';
const css = postcss.parse(fs.readFileSync(new URL('../../../dev/assets/css/root.css', import.meta.url), 'utf8'));

test('nearby focused/unfocused GLBs have equal distance sizing across regional views and camera angles', () => {
  const time=C.JulianDate.now();
  for (const domain of ['aircraft','naval']) for (const [lon,lat] of [[-96,40],[45,28]]) {
    let reads=0;
    const read=(name,fallback)=>{reads++; return styleAt(1920)(name,fallback);};
    const normal=readGlbSizing(read,domain,'naval');
    const focused={...normal,focused:true,focusSize:20,focusMinimum:200};
    const position=C.Cartesian3.fromDegrees(lon,lat);
    const entity=new C.Entity({position:C.Cartesian3.add(position,new C.Cartesian3(-50,0,0),new C.Cartesian3()),model:{uri:'existing.glb'}});
    const viewer={camera:{positionWC:new C.Cartesian3(40000000,0,0)},scene:{}};
    applyGlbDistanceSizing(entity,normal,viewer);
    const neighbor = new C.Entity({position:C.Cartesian3.add(position,new C.Cartesian3(50,0,0),new C.Cartesian3()),model:{uri:'existing.glb'}});
    applyGlbDistanceSizing(neighbor,normal,viewer);
    const property=entity.model.scale,model=entity.model,beforeReads=reads;
    for(const distance of [40000000,8000000,1200000,2500,1200000,40000000]) for(const direction of [new C.Cartesian3(1,0,0),new C.Cartesian3(0,0,1)]){
      C.Cartesian3.add(position,C.Cartesian3.multiplyByScalar(direction,distance,new C.Cartesian3()),viewer.camera.positionWC);
      applyGlbDistanceSizing(entity,focused,viewer);
      assert.ok(Math.abs(property.getValue(time)-neighbor.model.scale.getValue(time))<1e-5);
      assert.ok(Math.abs(entity.model.minimumPixelSize.getValue(time)-neighbor.model.minimumPixelSize.getValue(time))<1e-3);
      assert.ok(entity.model.minimumPixelSize.getValue(time)>=40);
      assert.equal(entity.model.maximumScale,undefined);
    }
    assert.equal(reads,beforeReads,'no per-frame CSS reads');
    C.Cartesian3.add(position,new C.Cartesian3(40000000,0,0),viewer.camera.positionWC);
    const before=property.getValue(time);
    applyGlbDistanceSizing(entity,focused,viewer);
    assert.ok(Math.abs(property.getValue(time)-before)<.2,'no focus pop');
    assert.equal(property.getValue(time),before,'legacy focus endpoint is ignored');
    applyGlbDistanceSizing(entity,normal,viewer);
    assert.ok(Math.abs(property.getValue(time)-5/3)<1e-9);
    assert.equal(entity.model,model);assert.equal(entity.model.scale,property);
  }
});

test('focus CSS values are never read by the active shared sizing path', () => {
  for(const domain of ['aircraft','naval']) {
    const read=(name,fallback)=>{
      assert.equal(name.includes('focused-'),false);
      return fallback;
    };
    const normal=readGlbSizing(read,domain,'fighter',1,false);
    const focused=readGlbSizing(read,domain,'fighter',1,true);
    assert.deepEqual(normal,focused);
  }
});
function styleAt(width) {
  const values = new Map();
  css.walkDecls(d => {
    if (d.parent.selector !== ':root') return;
    const m = d.parent.parent;
    if (m.type === 'atrule' && m.name === 'media') for (const [, bound, n] of m.params.matchAll(/(min|max)-width:\s*(\d+)px/g)) {
      if (bound === 'min' ? width < +n : width > +n) return;
    }
    values.set(d.prop, d.value);
  });
  const resolve = n => {
    const v = values.get(n) || '',
      ref = v.match(/^var\(([^)]+)\)$/);
    return ref ? resolve(ref[1]) : v;
  };
  return (n, f) => Number.isFinite(parseFloat(resolve(n))) ? parseFloat(resolve(n)) : f;
}
test('five CSS tiers drive actual Cesium properties with reversible focus-independent distance sizing', t => {
  const time = C.JulianDate.now();
  for (const [width, far, near] of [390,768,1920,1921,2559,2560,3839,3840].map(width=>[width,5,10])) for (const [domain, category] of [['aircraft', 'fighter'], ['naval', 'naval']]) {
    const read = styleAt(width),
      config = readGlbSizing(read, domain, category);
    const override = domain === 'aircraft' && width >= 2560 && width <= 3839 ? 9 : null;
    const expectedFar = override ?? far, expectedNear = near;
    assert.equal(config.farSize, expectedFar);
    assert.equal(config.nearSize, expectedNear);
    const entity = new C.Entity({
        position: C.Cartesian3.fromDegrees(50, 30),
        model: {
          uri: 'fixture.glb'
        }
      }),
      position = entity.position.getValue(time),
      viewer = {
        camera: {
          positionWC: new C.Cartesian3()
        },
        scene: {
          canvas: {
            clientWidth: width
          },
          drawingBufferWidth: width * 2
        }
      };
    applyGlbDistanceSizing(entity, config, viewer);
    const property = entity.model.scale,
      scales = [];
    for (const distance of [160000, 80000, 2500, 80000, 160000]) {
      C.Cartesian3.add(position, new C.Cartesian3(distance, 0, 0), viewer.camera.positionWC);
      const scale = entity.model.scale.getValue(time);
      applyGlbDistanceSizing(entity, config, viewer);
      assert.equal(entity.model.scale, property);
      assert.equal(entity.model.scale.getValue(time), scale);
      scales.push(scale);
      t.diagnostic(JSON.stringify({
        width,
        domain,
        distance,
        cssFar: far,
        cssNear: near,
        scale,
        minimumPixels: entity.model.minimumPixelSize.getValue(time),
        maximumScale: entity.model.maximumScale?.getValue(time)
      }));
    }
    assert.ok(Math.abs(scales[0] - expectedFar / 3) < 1e-9);
    assert.ok(Math.abs(scales[2] - expectedNear / 3) < 1e-9);
    assert.ok(scales[0] <= scales[1] && scales[1] <= scales[2]);
    assert.equal(scales[0], scales[4]);
  }
});
test('category and verified-dimension overrides remain independent', () => {
  const config = readGlbSizing((n, f) => ({
    '--warzone-live-naval-model-scale-max-carrier': 9
  })[n] ?? f, 'naval', 'carrier', 330 / 41.16168);
  const e = new C.Entity({
    position: new C.Cartesian3(),
    model: {
      uri: 'Carrier-US.glb'
    }
  });
  applyGlbDistanceSizing(e, config, {
    camera: {
      positionWC: new C.Cartesian3(1000, 0, 0)
    },
    scene: {}
  });
  assert.ok(Math.abs(e.model.scale.getValue(C.JulianDate.now()) - 3 * 330 / 41.16168) < 1e-9);
});
test('aircraft styling installs the distance properties after legacy sizing and preserves them at focus-equivalent distances', () => {
  const source = fs.readFileSync(new URL('../../../dev/assets/js/warzone-live-airforce.js', import.meta.url), 'utf8');
  const entity = new C.Entity({
    position: new C.Cartesian3(),
    model: {
      uri: '/assets/images/models/air/Fighter-F16.glb'
    }
  });
  const viewer = {
    camera: {
      positionWC: new C.Cartesian3(2500, 0, 0)
    },
    scene: {}
  };
  const context = vm.createContext({
    window: {
      __warzoneViewer: viewer
    },
    readGlbSizing,
    applyGlbDistanceSizing,
    getCssNumber: styleAt(1920),
    getAircraftFocusedSizingCategory: () => 'fighter',
    isFocusedTrackKey: () => false,
    getLiveTrackStyleConfig: () => ({}),
    getLiveTrackSubtypeScale: () => 999,
    getLiveTrackSubtypeMinPixelSize: () => 999,
    getLiveTrackSubtypeMaxScale: () => 999
  });
  for (const name of ['applyAircraftDistanceSizing', 'applyLiveTrackModelSizing']) {
    const start = source.indexOf(`function ${name}(`);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  }
  context.applyLiveTrackModelSizing(entity, {});
  const property = entity.model.scale,
    time = C.JulianDate.now();
  assert.ok(Math.abs(property.getValue(time) - 10 / 3) < 1e-9);
  context.applyLiveTrackModelSizing(entity, {});
  assert.equal(entity.model.scale, property);
  viewer.camera.positionWC.x = 160000;
  assert.equal(property.getValue(time), 5/3);
});
