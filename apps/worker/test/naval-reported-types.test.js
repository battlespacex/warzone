import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse, parseExpressionAt } from 'acorn';
import { resolveNavalIdentity, reportedVesselType, selectVerifiedNavalModel } from '../../shared/naval-identity.js';
import { normalizeNavalObservation } from '../src/tracking/naval/normalize.js';

test('provider categories and AIS codes do not verify military affiliation or select military models',()=>{
    for(const [value,expected] of [['Destroyer','destroyer'],['Patrol vessel','patrol'],['Coast Guard cutter','patrol'],
        ['Naval auxiliary','auxiliary'],['Aircraft carrier','carrier'],['Frigate','frigate'],['Submarine','submarine'],
        ['Amphibious','amphibious'],[51,'search_and_rescue'],[55,'law_enforcement'],[70,'cargo'],[80,'tanker'],
        [60,'passenger'],[30,'fishing'],[35,'unknown'],[0,'unknown']]) {
        const identity=resolveNavalIdentity({metadata:{ship_type:value},vessel_name:'HMS CG PLAN USNS example'});
        assert.equal(identity.category,expected);
        assert.equal(identity.verification_status,'unverified');assert.equal(identity.naval_force,'');assert.equal(identity.operator,'');
        assert.notEqual(identity.military_status,'military');assert.equal(selectVerifiedNavalModel(identity),'');
    }
    assert.equal(reportedVesselType({vessel_name:'USS DESTROYER',subcategory:'carrier',operator:'US Navy'}),'unknown');
});

test('explicit provider type survives normalizing without a new identity lookup',()=>{
    const result=normalizeNavalObservation('fixture',{ship_type:'Patrol vessel',mmsi:'999000001',
        latitude:25,longitude:57,observed_at:'2026-11-24T12:00:00Z'});
    assert.equal(resolveNavalIdentity(result).category,'patrol');
});

test('type dropdown exposes only categories present in its supplied data including Unknown',()=>{
    const source=fs.readFileSync(new URL('../../../dev/assets/js/essential.js',import.meta.url),'utf8');
    const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
    const c=vm.createContext({});
    for(const name of ['NAVAL_EVENT_SUBTYPES','NAVAL_SUBTYPE_ALIAS_MAP']){
        const declaration=ast.body.filter(n=>n.type==='VariableDeclaration').flatMap(n=>n.declarations).find(n=>n.id.name===name);
        vm.runInContext(`const ${source.slice(declaration.start,declaration.end)};`,c);
    }
    for(const name of ['normalizeNavalSubtype','formatNavalSubtypeLabel','getNavalSubtypeOptions']){
        const start=source.indexOf(`function ${name}(`);
        vm.runInContext(source.slice(start,parseExpressionAt(source,start,{ecmaVersion:'latest'}).end),c);
    }
    const rows=['carrier','destroyer','frigate','submarine','patrol','amphibious','auxiliary','law_enforcement','naval'].map(subcategory=>({subcategory}));
    const options=Array.from(c.getNavalSubtypeOptions(rows));
    for(const row of rows) assert.ok(options.includes(c.normalizeNavalSubtype(row.subcategory)));
    assert.equal(c.formatNavalSubtypeLabel('naval'),'Unknown / unclassified');
    assert.equal(c.getNavalSubtypeOptions([]).length,0);
    for(const option of options) assert.ok(rows.filter(row=>c.normalizeNavalSubtype(row.subcategory)===option).length>0);
});
