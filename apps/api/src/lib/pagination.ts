import {z} from 'zod';
const querySchema=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(50),search:z.string().trim().max(120).optional(),status:z.string().trim().max(50).optional(),sort:z.string().max(80).optional()});
export function pageQuery(value:unknown){const q=querySchema.parse(value);return {...q,offset:(q.page-1)*q.limit};}
export function safeSort(sort:string|undefined,allowed:Record<string,string>,fallback:string){const [field,dir]=sort?.split(':')??[fallback,'desc'];return {column:field&&Object.hasOwn(allowed,field)?allowed[field]:allowed[fallback],direction:dir?.toLowerCase()==='asc'?'asc':'desc'};}
export function pageResult<T>(data:T[],page:number,limit:number,total:number){return {data,meta:{page,limit,total,totalPages:Math.ceil(total/limit)}};}
