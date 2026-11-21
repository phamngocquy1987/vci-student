"""Runtime Excel download matching the school's nine-column roster layout."""
from datetime import date
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.page import PageMargins
from .excel import REFERENCE_HEADERS


def build_student_template(school_class):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'DanhSachLop'
    sheet.sheet_view.showGridLines = False
    for area in ('A1:D1', 'E1:I1', 'A2:D2', 'E2:I2', 'A4:I4', 'A5:I5', 'A27:I27'):
        sheet.merge_cells(area)
    sheet['A1'] = 'BỘ GIÁO DỤC VÀ ĐÀO TẠO'
    sheet['E1'] = 'CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM'
    sheet['A2'] = 'TRƯỜNG CAO ĐẲNG CÔNG THƯƠNG VIỆT NAM'
    sheet['E2'] = 'Độc lập - Tự do - Hạnh phúc'
    code = school_class['code'] if school_class else '[MÃ LỚP]'
    sheet['A4'] = f'DANH SÁCH LỚP {code} - NGÀNH [TÊN NGÀNH]'
    sheet['A5'] = '(Kèm theo Quyết định số … ngày …\ncủa Hiệu trưởng Trường Cao đẳng Công thương Việt Nam)'
    sheet['A27'] = 'Tổng danh sách có … sinh viên./.'
    for column, title in enumerate(REFERENCE_HEADERS, 1):
        sheet.cell(6, column, title)
    # Fictional example; never copy personal information from a screenshot into a template.
    example = [1, 'Sinh viên', 'Mẫu', date(2008, 1, 1), 'Đắk Lắk', 'Nam', 'Kinh', None,
               'Dòng minh họa; thay trước khi nhập']
    for column, value in enumerate(example, 1):
        sheet.cell(7, column, value)
    widths = [5, 23, 15, 16, 18, 12, 13, 22, 26]
    thin = Side(style='thin', color='000000')
    for index, width in enumerate(widths, 1):
        sheet.column_dimensions[get_column_letter(index)].width = width
    for cells in sheet.iter_rows(min_row=1, max_row=27, max_col=9):
        for cell in cells:
            cell.font = Font(name='Times New Roman', size=12)
            cell.alignment = Alignment(vertical='center', wrap_text=True)
    for address in ('A1', 'E1', 'A2', 'E2', 'A4', 'A5'):
        sheet[address].alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    for address in ('E1', 'A2', 'E2', 'A4'):
        sheet[address].font = Font(name='Times New Roman', size=12 if address != 'A2' else 10, bold=True)
    sheet['A5'].font = Font(name='Times New Roman', size=12, italic=True)
    sheet['A27'].font = Font(name='Times New Roman', size=12, italic=True)
    for cells in sheet.iter_rows(min_row=6, max_row=26, max_col=9):
        for cell in cells:
            cell.border = Border(left=thin, right=thin, top=thin, bottom=thin)
            if cell.row == 6:
                cell.font = Font(name='Times New Roman', size=12, bold=True)
                cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
            elif cell.column in (1, 4, 6, 7, 8):
                cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
            if cell.row > 6 and cell.column == 4:
                cell.number_format = 'dd/mm/yyyy'
            if cell.row > 6 and cell.column == 8:
                cell.number_format = '@'
    for row in range(1, 28):
        sheet.row_dimensions[row].height = 23 if row >= 6 else 24
    sheet.row_dimensions[3].height = 10
    sheet.row_dimensions[5].height = 39
    sheet.row_dimensions[7].height = 40
    sheet.freeze_panes = 'D7'
    sheet.print_options.horizontalCentered = True
    sheet.print_area = 'A1:I27'
    sheet.page_setup.orientation = 'landscape'
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 1
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_margins = PageMargins(left=0.25, right=0.25, top=0.4, bottom=0.4)
    return workbook
