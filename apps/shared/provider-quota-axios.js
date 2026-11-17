import {createQuotaFetch} from './provider-quota.js';

// Adapt the legacy dispatcher's existing Axios transport; no global interceptor.
export function createQuotaAxios(axios,env=process.env) {
    const client=axios.create(),transport=axios.getAdapter(axios.defaults.adapter);
    client.defaults.adapter=async config=>{
        const request=createQuotaFetch({env,fetchImpl:async (_url,options)=>{
            const result=await transport({...config,signal:options.signal,...(options.redirect==='error'?{maxRedirects:0}:{}),validateStatus:()=>true});
            return new Response(result.data || null,{status:result.status,headers:result.headers.toJSON()});
        }});
        const response=await request(client.getUri(config),{
            method:config.method.toUpperCase(),headers:config.headers.toJSON(),body:config.data,signal:config.signal
        });
        const result={data:await response.text(),status:response.status,statusText:response.statusText,
            headers:Object.fromEntries(response.headers),config,request:{}};
        if(config.validateStatus&&!config.validateStatus(result.status))throw new axios.AxiosError('Provider HTTP '+result.status,
            result.status>=500?'ERR_BAD_RESPONSE':'ERR_BAD_REQUEST',config,result.request,result);
        return result;
    };
    return client;
}
