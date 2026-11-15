import {normalizeNotice,parseNotam} from './geospatial-notices.js';

export function createOfficialNoticeAdapter(id) {
    if(!['aai','navareaIX'].includes(id))throw Error('Unknown official provider');
    return {id,enabled:false,diagnostics:()=>({state:'import-only',reason:'Approved machine access and redistribution contract required'})};
}
// REST notice documentation names endpoints but omits complete row schemas. Accept canonical
// records or reviewed raw ICAO text only; never invent authority, source link, dates or geometry.
export function skySpyNotice(row,now=Date.now()) {
    if(row?.rawText&&row?.sourceUrl&&row?.issuer){
        if(!row.sourceId&&/\bNOTAM[NRC]\b/.test(row.rawText))return parseNotam(row.rawText,{...row,provider:'skyspy',now});
        return normalizeNotice({...row,provider:'skyspy'},now);
    }
    throw Error('Deployed notice row requires an authoritative field mapping');
}
