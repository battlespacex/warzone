// Backend/operator CLI only; contacts the configured quota store, never providers.
import {loadWorkerEnv} from '../src/env.js';
import {resolveQuotaPolicy,getProviderQuotaDiagnostics} from '../../shared/provider-quota.js';
loadWorkerEnv();
const env=process.env;
const entries=[
    ['notac','https://notac.aero/api/v1/notam/delta/',env.NOTAC_API_KEY],
    ['skylink','https://data.skylinkapi.com/v3.1/aircraft/icao24/example',env.SKYLINK_API_KEY],
    ['skylink-rapidapi','https://skylink-api.p.rapidapi.com/v3/notams/ICAO',env.SKYLINK_RAPIDAPI_KEY],
    ['vesselapi','https://api.vesselapi.com/v1/vessel',env.VESSELAPI_API_KEY],
    ['adsb_lol','https://api.adsb.lol/v2/mil',null],
    ['opensky','https://opensky-network.org/api/states/all',env.OPENSKY_CLIENT_ID],
    ['restcountries','https://api.restcountries.com/countries/v5',env.RESTCOUNTRIES_API_KEY],
    ['copernicus','https://sh.dataspace.copernicus.eu/catalog/v1/search',env.COPERNICUS_CLIENT_ID],
    ['copernicus-process','https://sh.dataspace.copernicus.eu/api/v1/process',env.COPERNICUS_CLIENT_ID],
    ['airplanes_live','https://api.airplanes.live/v2/mil',null],
    ['celestrak','https://celestrak.org/NORAD/elements/gp.php?GROUP=military&FORMAT=JSON',null],
    ['gnss','https://api.gpsinterference.com/v1/interference/latest',null],
    ['cloudflare','https://api.cloudflare.com/client/v4/radar/annotations/outages',env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_RADAR_API_TOKEN],
    ['otx','https://otx.alienvault.com/api/v1/pulses/subscribed',env.OTX_API_KEY]
];
for(const [label,url,credential]of entries) {
    if(!credential&&!['adsb_lol','airplanes_live','celestrak','gnss'].includes(label))continue;
    const policy=resolveQuotaPolicy(url,{},env,credential?{credential}:{});
    try {console.log(JSON.stringify({label,...await getProviderQuotaDiagnostics(policy)}));}
    catch {console.error(JSON.stringify({label,error:'quota store unavailable; verify manual migration/configuration'}));process.exitCode=1;}
}
