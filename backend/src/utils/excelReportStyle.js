export const ATTENDANCE_REPORT_THEME={
  title:'#17365D',subtitle:'#DCEAF7',subtitleText:'#38546E',headers:['#1F4E78','#2F75B5','#5B9BD5'],sections:['#D9EAF7','#E8F1F8','#EFF6FB'],sectionText:'#244B6B',even:'#FFFFFF',odd:'#F3F7FB',border:'#D5E1EC',bodyText:'#263746',accent:'#1F4E78',
}

export const EMPLOYEE_REPORT_THEME={
  title:'#3D1B56',subtitle:'#EFE5F5',subtitleText:'#624173',headers:['#5B2C83','#7A4AA0','#9B72B5'],sections:['#E8DDF0','#F0E8F5','#F6F0F8'],sectionText:'#553067',even:'#FFFFFF',odd:'#FAF7FC',border:'#E4D9EA',bodyText:'#352D3A',accent:'#6A378D',
}

export function reportSectionRow(sections,theme){
  const row=[]
  sections.forEach(({label,span},index)=>{row.push({value:label,columnSpan:span,fontWeight:'bold',fontSize:9,textColor:theme.sectionText,backgroundColor:theme.sections[index],align:'center',alignVertical:'center',height:22,bottomBorderColor:theme.border,bottomBorderStyle:'thin'});for(let position=1;position<span;position++)row.push(null)})
  return row
}

export function reportHeaderRow(headers,spans,theme){
  let group=0,remaining=spans[0]
  return headers.map(value=>{const cell={value,fontWeight:'bold',fontSize:9,textColor:'#FFFFFF',backgroundColor:theme.headers[group],align:'center',alignVertical:'center',wrap:true,height:34,borderColor:'#FFFFFF',borderStyle:'thin'};remaining--;if(remaining===0&&group<spans.length-1){group++;remaining=spans[group]}return cell})
}

export function reportCell(value,rowIndex,theme,extra={}){
  return {value:value??'',backgroundColor:rowIndex%2===1?theme.odd:theme.even,textColor:theme.bodyText,borderColor:theme.border,borderStyle:'thin',alignVertical:'center',wrap:true,height:22,...extra}
}

export function statusCellStyle(status){
  const value=String(status||'').toLowerCase()
  if(['active','present','approved','confirmed','verified'].includes(value))return {backgroundColor:'#E2F3E8',textColor:'#25633F',fontWeight:'bold',align:'center'}
  if(['late','pending','pending_confirmation','in_probation','probation'].includes(value))return {backgroundColor:'#FFF0CC',textColor:'#865D13',fontWeight:'bold',align:'center'}
  if(['absent','terminated','rejected','missing_checkout','inactive'].includes(value))return {backgroundColor:'#FBE1E5',textColor:'#96394B',fontWeight:'bold',align:'center'}
  if(['wfh','on_leave','permanent'].includes(value))return {backgroundColor:'#E1ECFA',textColor:'#315F91',fontWeight:'bold',align:'center'}
  if(['notice_period','extended'].includes(value))return {backgroundColor:'#EEE5F6',textColor:'#68428B',fontWeight:'bold',align:'center'}
  return {backgroundColor:'#EEF1F4',textColor:'#53606D',fontWeight:'bold',align:'center'}
}
