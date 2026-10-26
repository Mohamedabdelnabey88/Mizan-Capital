/** A gateway, static host or interrupted upstream may return HTML even for API requests. */
export class ApiResponseError extends Error {
 constructor(public status:number,public uncertain:boolean){super('تعذر استلام رد صالح من الخادم المالي (HTTP '+status+'). حدّث البيانات وراجع حالة العملية قبل إعادة المحاولة؛ قد تكون العملية حُفظت بالفعل.');this.name='ApiResponseError';}
}
export async function readApiResponse(response:Response,mutation=false):Promise<any>{
 let text:string;
 try{text=await response.text();}catch{throw new ApiResponseError(response.status,mutation);}
 try{const data=JSON.parse(text);if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}
 catch{throw new ApiResponseError(response.status,mutation);}
}
