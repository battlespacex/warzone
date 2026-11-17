// Independent local ISO 3166 alpha-2/alpha-3 crosswalk; English display names
// come from Node's ICU/Unicode CLDR data (Unicode license in the Node distribution).
// No REST Countries response data is bundled or retained here.
const pairs=`AD AND AE ARE AF AFG AG ATG AI AIA AL ALB AM ARM AO AGO AQ ATA AR ARG AS ASM AT AUT AU AUS AW ABW AX ALA AZ AZE
BA BIH BB BRB BD BGD BE BEL BF BFA BG BGR BH BHR BI BDI BJ BEN BL BLM BM BMU BN BRN BO BOL BQ BES BR BRA BS BHS BT BTN BV BVT BW BWA BY BLR BZ BLZ
CA CAN CC CCK CD COD CF CAF CG COG CH CHE CI CIV CK COK CL CHL CM CMR CN CHN CO COL CR CRI CU CUB CV CPV CW CUW CX CXR CY CYP CZ CZE
DE DEU DJ DJI DK DNK DM DMA DO DOM DZ DZA EC ECU EE EST EG EGY EH ESH ER ERI ES ESP ET ETH FI FIN FJ FJI FK FLK FM FSM FO FRO FR FRA
GA GAB GB GBR GD GRD GE GEO GF GUF GG GGY GH GHA GI GIB GL GRL GM GMB GN GIN GP GLP GQ GNQ GR GRC GS SGS GT GTM GU GUM GW GNB GY GUY
HK HKG HM HMD HN HND HR HRV HT HTI HU HUN ID IDN IE IRL IL ISR IM IMN IN IND IO IOT IQ IRQ IR IRN IS ISL IT ITA JE JEY JM JAM JO JOR JP JPN
KE KEN KG KGZ KH KHM KI KIR KM COM KN KNA KP PRK KR KOR KW KWT KY CYM KZ KAZ LA LAO LB LBN LC LCA LI LIE LK LKA LR LBR LS LSO LT LTU LU LUX LV LVA LY LBY
MA MAR MC MCO MD MDA ME MNE MF MAF MG MDG MH MHL MK MKD ML MLI MM MMR MN MNG MO MAC MP MNP MQ MTQ MR MRT MS MSR MT MLT MU MUS MV MDV MW MWI MX MEX MY MYS MZ MOZ
NA NAM NC NCL NE NER NF NFK NG NGA NI NIC NL NLD NO NOR NP NPL NR NRU NU NIU NZ NZL OM OMN PA PAN PE PER PF PYF PG PNG PH PHL PK PAK PL POL PM SPM PN PCN PR PRI PS PSE PT PRT PW PLW PY PRY
QA QAT RE REU RO ROU RS SRB RU RUS RW RWA SA SAU SB SLB SC SYC SD SDN SE SWE SG SGP SH SHN SI SVN SJ SJM SK SVK SL SLE SM SMR SN SEN SO SOM SR SUR SS SSD ST STP SV SLV SX SXM SY SYR SZ SWZ
TC TCA TD TCD TF ATF TG TGO TH THA TJ TJK TK TKL TL TLS TM TKM TN TUN TO TON TR TUR TT TTO TV TUV TW TWN TZ TZA UA UKR UG UGA UM UMI US USA UY URY UZ UZB
VA VAT VC VCT VE VEN VG VGB VI VIR VN VNM VU VUT WF WLF WS WSM YE YEM YT MYT ZA ZAF ZM ZMB ZW ZWE`.split(/\s+/);
const names=new Intl.DisplayNames(['en'],{type:'region'}),lookup=new Map();
const normalize=value=>String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
for(let index=0;index<pairs.length;index+=2) {
    const alpha2=pairs[index],alpha3=pairs[index+1],value={name:names.of(alpha2),alpha2,alpha3};
    for(const alias of [alpha2,alpha3,value.name])lookup.set(normalize(alias),value);
}
for(const [alias,code]of Object.entries({UK:'GB',UAE:'AE','United Arab Emirates':'AE','United States of America':'US',
    'United Kingdom of Great Britain and Northern Ireland':'GB','Republic of Korea':'KR','Korea, South':'KR',
    'Korea, North':'KP','Russian Federation':'RU','Czech Republic':'CZ','Ivory Coast':'CI','Türkiye':'TR',
    'Democratic Republic of the Congo':'CD','Republic of the Congo':'CG'}))lookup.set(normalize(alias),lookup.get(normalize(code)));
export function lookupLocalCountry(value) {const country=lookup.get(normalize(value));return country?{...country}:null;}
export const localCountryCount=pairs.length/2;
