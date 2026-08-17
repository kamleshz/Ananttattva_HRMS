import test from 'node:test'
import assert from 'node:assert/strict'
import writeXlsxFile from 'write-excel-file/node'
import { ATTENDANCE_REPORT_THEME, EMPLOYEE_REPORT_THEME, reportCell, reportHeaderRow, reportSectionRow, statusCellStyle } from '../utils/excelReportStyle.js'

test('report themes use distinct professional palettes',()=>{
  assert.notEqual(ATTENDANCE_REPORT_THEME.title,EMPLOYEE_REPORT_THEME.title)
  assert.equal(ATTENDANCE_REPORT_THEME.headers.length,3)
  assert.equal(EMPLOYEE_REPORT_THEME.headers.length,3)
})

test('semantic statuses receive readable, distinct colors',()=>{
  assert.notEqual(statusCellStyle('active').backgroundColor,statusCellStyle('terminated').backgroundColor)
  assert.notEqual(statusCellStyle('late').textColor,statusCellStyle('present').textColor)
})

test('styled report rows generate a valid Excel workbook',async()=>{
  const theme=ATTENDANCE_REPORT_THEME,headers=['Employee','Status','Hours']
  const data=[
    [{value:'Sample Attendance',columnSpan:3,textColor:'#FFFFFF',backgroundColor:theme.title},null,null],
    reportSectionRow([{label:'EMPLOYEE',span:1},{label:'ATTENDANCE',span:2}],theme),
    reportHeaderRow(headers,[1,2],theme),
    [reportCell('EMP001',0,theme,{fontWeight:'bold'}),reportCell('present',0,theme,statusCellStyle('present')),reportCell(8.5,0,theme,{type:Number,format:'0.00'})],
  ]
  const buffer=await writeXlsxFile(data,{sheet:'Preview',showGridLines:false,stickyRowsCount:3},{fontFamily:'Calibri',fontSize:10}).toBuffer()
  assert.ok(buffer.byteLength>3000)
})
