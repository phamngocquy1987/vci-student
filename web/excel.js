import ExcelJS from 'exceljs';
import JSZip from 'jszip';
export const studentHeaders=['TT','Họ đệm','Tên','Ngày sinh','Nơi sinh','Giới tính','Dân tộc','Số CCCD','Ghi chú'];
export const scheduleHeaders=['Lớp','Cơ sở','Ngày','Bắt đầu','Kết thúc','Môn học','Giảng viên','Phòng','Loại','Trạng thái','Ghi chú'];
const normalize=v=>String(v??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');
const text=c=>{const v=c?.value;if(v&&typeof v==='object'&&!(v instanceof Date)){if(v.formula||v.sharedFormula)throw new Error('Không nhận công thức; hãy dán dưới dạng giá trị.');if(v.richText)return v.richText.map(x=>x.text).join('').trim();if(v.text)return v.text.trim();throw new Error('Ô dữ liệu không hợp lệ.');}return String(v??'').trim();};
export function dateValue(v){
 if(v instanceof Date)return v.toISOString().slice(0,10);
 let s=String(v??'').trim(),m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
 if(m)s=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw new Error('Ngày phải đúng dạng DD/MM/YYYY hoặc ô ngày Excel.');
 return s;
}
function timeValue(c){const v=c.value;if(v instanceof Date)return v.toISOString().slice(11,16);if(typeof v==='number'&&v>=0&&v<1){const n=Math.round(v*1440);return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}const s=text(c);if(!/^([01]?\d|2[0-3]):[0-5]\d$/.test(s))throw new Error('Giờ phải có dạng HH:MM.');return s.padStart(5,'0');}
export async function loadWorkbook(file){
 if(!file||!file.name?.toLowerCase().endsWith('.xlsx'))throw new Error('Chỉ hỗ trợ file .xlsx.');
 if(file.size>5*1024*1024)throw new Error('File vượt quá 5 MB.');
 const buffer=await file.arrayBuffer();
 try{
  // Inspect ZIP declarations before parsing worksheet XML. Reject unusually large
  // workbooks; also cap rows/columns below. No workbook is uploaded to GitHub.
  const zip=await JSZip.loadAsync(buffer);let expanded=0;
  for(const entry of Object.values(zip.files)){expanded+=entry._data?.uncompressedSize||0;if(expanded>30*1024*1024)throw new Error('Nội dung giải nén vượt quá 30 MB.');}
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);
  const sheet=workbook.worksheets[0];if(!sheet||sheet.rowCount>5031||sheet.columnCount>64)throw new Error('Tối đa 5.000 dòng, 64 cột; phần tiêu đề tối đa 30 dòng.');
  return sheet;
 }catch(e){throw new Error(e.message?.includes('MB')||e.message?.includes('5.000')?e.message:'Không đọc được file .xlsx. Hãy dùng mẫu của hệ thống.');}
}
export async function parseUpload(form,students,classes){
 const sheet=await loadWorkbook(form.get('file'));
 const target=classes.find(c=>c.id===Number(form.get('class_id')));
 const rows=[],errors=[];
 let header=1,school=false,positions,fields;
 const locate=(row,titles)=>{const names=Array.from({length:Math.min(sheet.columnCount,64)},(_,i)=>normalize(text(row.getCell(i+1))));const wanted=titles.map(normalize);if(!wanted.every(h=>names.includes(h)))return null;if(wanted.some(h=>names.filter(n=>n===h).length!==1))throw new Error('Bảng có tiêu đề cột bị trùng.');return wanted.map(h=>names.indexOf(h)+1);};
 if(students){
  for(let i=1;i<=Math.min(30,sheet.rowCount);i++){positions=locate(sheet.getRow(i),studentHeaders);if(positions){header=i;school=true;break;}}
  if(school){
   if(!target)throw new Error('Hãy chọn lớp nhận danh sách.');
   for(let i=1;i<header;i++)sheet.getRow(i).eachCell(c=>{const match=normalize(text(c)).match(/danh sach lop\s+(.+?)(?:\s*-\s*nganh\b|$)/);if(match&&!['...','…','[ma lop]'].includes(match[1].trim())&&match[1].trim()!==normalize(target.code))throw new Error('Tên lớp trong tiêu đề khác lớp đang chọn.');});
  }else{positions=locate(sheet.getRow(1),['Mã sinh viên','Họ và tên','Lớp','Cơ sở']);fields=['username','full_name','class_code','campus'];}
 }else{positions=locate(sheet.getRow(1),scheduleHeaders);fields=['class_code','campus','date','start','end','subject','lecturer','room','kind','status','note'];}
 if(!positions)throw new Error('Thiếu cột. Hãy tải mẫu Excel và giữ nguyên tiêu đề.');
 let summary=false;
 for(let n=header+1;n<=sheet.rowCount;n++){
  const cells=positions.map(p=>sheet.getRow(n).getCell(p));
  if(cells.every(c=>c.value===null||c.value===''))continue;
  try{
   const values=cells.map(text);let row={_row:n};
   if(school){
    if(values.slice(0,3).some(v=>/^(tong danh sach|tong so sinh vien)/.test(normalize(v)))){summary=true;continue;}
    if(summary){if(/^\d+$/.test(values[0])&&(values[1]||values[2]))throw new Error('Có sinh viên nằm sau dòng tổng.');continue;}
    if(!/^[1-9]\d*$/.test(values[0]))throw new Error('TT phải là số nguyên dương.');
    let identity=values[7];
    if(typeof cells[7].value==='number'&&cells[7].numFmt==='000000000000')identity=identity.padStart(12,'0');
    if(!/^\d{12}$/.test(identity))throw new Error('Số CCCD phải đủ 12 chữ số. Nhập dạng văn bản để giữ số 0 đầu.');
    row={...row,source_format:'school',source_index:Number(values[0]),surname:values[1],given_name:values[2],full_name:[values[1],values[2]].filter(Boolean).join(' '),birth_date:values[3]?dateValue(cells[3].value):'',birth_place:values[4],gender:values[5],ethnicity:values[6],national_id:identity,note:values[8],username:identity,class_code:target.code,campus:target.campus};
   }else{
    fields.forEach((f,i)=>row[f]=values[i]);
    if(students&&target&&(row.class_code!==target.code||row.campus!==target.campus))throw new Error('Lớp/cơ sở trong file khác lớp đang chọn.');
    if(!students){row.date=dateValue(cells[2].value);row.start=timeValue(cells[3]);row.end=timeValue(cells[4]);row.kind=normalize(row.kind);row.status=normalize(row.status).replace(' ','_');}
   }
   rows.push(row);if(rows.length>5000)throw new Error('Chỉ nhập tối đa 5.000 dòng.');
  }catch(e){errors.push({row:n,message:e.message});}
 }
 if(rows.length>5000)throw new Error('Chỉ nhập tối đa 5.000 dòng.');
 return {rows,errors};
}
async function save(workbook,name){const buffer=await workbook.xlsx.writeBuffer();const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function sheetStyle(sheet){sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).font={bold:true};sheet.columns.forEach(c=>c.width=22);}
export async function downloadStudentTemplate(c){
 if(!c)throw new Error('Hãy chọn lớp nhận danh sách.');
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('DanhSachLop');
 ['A1:D1','E1:I1','A2:D2','E2:I2','A4:I4','A5:I5','A27:I27'].forEach(r=>s.mergeCells(r));
 const headings={'A1':'BỘ GIÁO DỤC VÀ ĐÀO TẠO','E1':'CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM','A2':'TRƯỜNG CAO ĐẲNG CÔNG THƯƠNG VIỆT NAM','E2':'Độc lập - Tự do - Hạnh phúc','A4':`DANH SÁCH LỚP ${c.code} - NGÀNH [TÊN NGÀNH]`,'A5':'(Kèm theo Quyết định số … ngày …\ncủa Hiệu trưởng Trường Cao đẳng Công thương Việt Nam)','A27':'Tổng danh sách có … sinh viên./.'};
 for(const [cell,value]of Object.entries(headings)){s.getCell(cell).value=value;s.getCell(cell).alignment={horizontal:'center',vertical:'middle',wrapText:true};s.getCell(cell).font={name:'Times New Roman',size:12,bold:!['A5','A27'].includes(cell)};}
 s.getRow(6).values=studentHeaders;
 s.getRow(7).values=[1,'Sinh viên','Mẫu',new Date('2008-01-01T00:00:00Z'),'Đắk Lắk','Nam','Kinh',null,'Dòng minh họa; thay trước khi nhập'];
 [5,23,15,16,18,12,13,22,26].forEach((width,i)=>s.getColumn(i+1).width=width);
 for(let row=6;row<=26;row++)for(let col=1;col<=9;col++){const cell=s.getCell(row,col);cell.font={name:'Times New Roman',size:12,bold:row===6};cell.border={top:{style:'thin'},left:{style:'thin'},bottom:{style:'thin'},right:{style:'thin'}};cell.alignment={vertical:'middle',wrapText:true};if(row>6&&col===8)cell.numFmt='@';if(row>6&&col===4)cell.numFmt='dd/mm/yyyy';}
 s.getRow(5).height=39;s.getRow(7).height=40;s.views=[{state:'frozen',ySplit:6,xSplit:3,showGridLines:false}];s.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:1,printArea:'A1:I27'};
 return save(w,'VCI-SinhVien-Mau.xlsx');
}
export async function downloadScheduleTemplate(c){const w=new ExcelJS.Workbook(),s=w.addWorksheet('Lich');s.addRow(scheduleHeaders);s.addRow([c?.code||'[MÃ LỚP]',c?.campus||'Hà Nội',new Date(),'07:30','10:00','Môn minh họa','Giảng viên mẫu','P101','hoc','hoc','Thay dòng minh họa trước khi nhập']);s.getCell('C2').numFmt='dd/mm/yyyy';sheetStyle(s);return save(w,'VCI-Lich-Mau.xlsx');}
export async function downloadAccounts(rows){const w=new ExcelJS.Workbook(),s=w.addWorksheet('TaiKhoan');s.addRow(['Mã đăng nhập','Họ và tên','Lớp','Cơ sở','Năm quản lý']);rows.forEach(row=>{const r=s.addRow(row);r.getCell(1).numFmt='@';});sheetStyle(s);return save(w,'VCI-TaiKhoan-VuaTao.xlsx');}
