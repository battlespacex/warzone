// Catalog metadata is NOT a vessel detection or naval activity observation.
export const catalogEndpoints={
 'API-004':'https://stac.dataspace.copernicus.eu/v1/collections',
 'API-005':'https://catalogue.dataspace.copernicus.eu/odata/v1/Products?$top=1&$select=Id,Name,ContentDate,GeoFootprint'
};
export async function readNavalCatalog(id,{fetchImpl=fetch}={}){
 const endpoint=catalogEndpoints[id];if(!endpoint)throw Error('Unknown catalog');
 const response=await fetchImpl(endpoint,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});if(!response.ok){const e=Error('Catalog unavailable');e.status=response.status;throw e;}
 const text=await response.text();if(text.length>4000000)throw Error('Catalog exceeds limit');const data=JSON.parse(text);
 const items=id==='API-004'?data.collections:data.value;if(!Array.isArray(items))throw Error('Invalid catalog schema');
 return {kind:'imagery_catalog_only',vessel_detections:0,endpoint,items:items.slice(0,20).map(item=>id==='API-004'?{id:item.id,title:item.title,extent:item.extent}:{id:item.Id,name:item.Name,dates:item.ContentDate,footprint:item.GeoFootprint})};
}
