import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { InventoryItem, StockMovement, PurchaseOrder } from '../types';
import { formatPdfCurrency } from './utils';

// Brand colors
const PRIMARY_PURPLE = '#2B1A70';
const DARK_PURPLE = '#120E2B';
const ACCENT_ORANGE = '#E54818';
const TEXT_DARK = '#1E1B4B';
const BG_OFF_WHITE = '#FAF8F5';

/**
 * Helper to add standard Saka Homes branded document header
 */
function addDocumentHeader(
  doc: jsPDF,
  title: string,
  subtitle: string,
  dateLabel: string
) {
  const pageWidth = doc.internal.pageSize.width;

  // Header Background Bar
  doc.setFillColor(PRIMARY_PURPLE);
  doc.rect(0, 0, pageWidth, 28, 'F');

  // Orange Accent Line at bottom of header
  doc.setFillColor(ACCENT_ORANGE);
  doc.rect(0, 28, pageWidth, 2, 'F');

  // Company Name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text('SAKA HOMES', 14, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(230, 220, 255);
  doc.text('CONSTRUCTION & REAL ESTATE DEVELOPMENT LTD', 14, 18);

  // Document Title on Top Right
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(title.toUpperCase(), pageWidth - 14, 13, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(255, 215, 180);
  doc.text(`DATE SCOPE: ${dateLabel}`, pageWidth - 14, 20, { align: 'right' });

  // Subtitle / Meta bar under header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text(subtitle, 14, 37);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 110, 130);
  const generatedTime = `Generated: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  doc.text(generatedTime, pageWidth - 14, 37, { align: 'right' });

  // Divider
  doc.setDrawColor(220, 225, 235);
  doc.setLineWidth(0.5);
  doc.line(14, 41, pageWidth - 14, 41);
}

/**
 * Helper to add standard Saka Homes branded footer on each page
 */
function addDocumentFooter(doc: jsPDF) {
  const pageCount = doc.internal.pages.length - 1;
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(230, 230, 240);
    doc.setLineWidth(0.5);
    doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(130, 135, 150);
    doc.text('Saka Homes Internal Operations Portal • Confidential Supply Chain Report', 14, pageHeight - 6);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, pageHeight - 6, { align: 'right' });
  }
}

/**
 * 1. EXPORT INVENTORY ITEMS TO PDF TABLE
 */
export function exportInventoryPDF(items: InventoryItem[], dateLabel: string) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  addDocumentHeader(
    doc,
    'Inventory Stock Catalog',
    `Total Material Records: ${items.length} items`,
    dateLabel
  );

  // Summary Metrics Bar
  const totalValuation = items.reduce((acc, i) => {
    const stock = i.currentStock !== undefined ? i.currentStock : i.reorderQty;
    return acc + (i.unitCost || 0) * stock;
  }, 0);
  const lowStockCount = items.filter(i => i.status === 'LOW STOCK').length;
  const outOfStockCount = items.filter(i => i.status === 'OUT OF STOCK').length;

  doc.setFillColor(250, 248, 245); // Warm background
  doc.roundedRect(14, 44, 269, 12, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(PrimaryPurpleToRGB()[0], PrimaryPurpleToRGB()[1], PrimaryPurpleToRGB()[2]);
  
  doc.text(`Total Store Valuation: ${formatPdfCurrency(totalValuation)}`, 18, 51.5);
  doc.text(`In Stock: ${items.length - lowStockCount - outOfStockCount}`, 110, 51.5);
  doc.setTextColor(217, 119, 6);
  doc.text(`Low Stock: ${lowStockCount}`, 170, 51.5);
  doc.setTextColor(225, 29, 72);
  doc.text(`Out of Stock: ${outOfStockCount}`, 220, 51.5);

  // Table Data
  const tableHeaders = [
    ['#', 'Code', 'Item Name', 'Category', 'Unit', 'Stock Qty', 'Min-Max', 'Unit Cost (GH\u00A2)', 'Valuation (GH\u00A2)', 'Supplier', 'Added By', 'Status']
  ];

  const tableRows = items.map((item, idx) => {
    const currStock = item.currentStock !== undefined ? item.currentStock : item.reorderQty;
    const valuation = (item.unitCost || 0) * currStock;
    return [
      idx + 1,
      item.itemCode || 'N/A',
      item.itemName,
      item.category,
      item.unitOfMeasure,
      currStock,
      `${item.minStockLevel} - ${item.maxStockLevel}`,
      formatPdfCurrency(item.unitCost),
      formatPdfCurrency(valuation),
      item.supplier || 'N/A',
      item.createdBy || 'admin',
      item.status
    ];
  });

  autoTable(doc, {
    head: tableHeaders,
    body: tableRows,
    startY: 60,
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [30, 27, 75],
      lineColor: [225, 228, 235],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [43, 26, 112], // PRIMARY_PURPLE
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'left',
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 20, fontStyle: 'bold' },
      2: { cellWidth: 38 },
      3: { cellWidth: 25 },
      4: { cellWidth: 14, halign: 'center' },
      5: { cellWidth: 18, halign: 'right', fontStyle: 'bold' },
      6: { cellWidth: 18, halign: 'center' },
      7: { cellWidth: 24, halign: 'right' },
      8: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
      9: { cellWidth: 28 },
      10: { cellWidth: 28 },
      11: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
    },
    alternateRowStyles: {
      fillColor: [250, 248, 245],
    },
    didParseCell: (data) => {
      // Style status column
      if (data.section === 'body' && data.column.index === 11) {
        const val = String(data.cell.raw);
        if (val === 'OUT OF STOCK') {
          data.cell.styles.textColor = [225, 29, 72];
        } else if (val === 'LOW STOCK') {
          data.cell.styles.textColor = [217, 119, 6];
        } else {
          data.cell.styles.textColor = [5, 150, 105];
        }
      }
    },
    foot: [
      ['', '', 'GRAND TOTALS', '', '', items.reduce((a, b) => a + (b.currentStock ?? b.reorderQty), 0), '', '', formatPdfCurrency(totalValuation), '', '', '']
    ],
    footStyles: {
      fillColor: [229, 72, 24], // ACCENT_ORANGE
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    }
  });

  addDocumentFooter(doc);
  doc.save(`saka-homes-inventory-catalog-${new Date().toISOString().split('T')[0]}.pdf`);
}

/**
 * 2. EXPORT STOCK MOVEMENTS / DISPATCHES TO PDF TABLE
 */
export function exportStockMovementsPDF(movements: StockMovement[], dateLabel: string) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  addDocumentHeader(
    doc,
    'Stock Movements & Site Dispatches',
    `Total Movement Records: ${movements.length} log entries`,
    dateLabel
  );

  const totalIssued = movements.filter(m => m.movementType === 'ISSUED_OUT').reduce((a, b) => a + b.quantity, 0);
  const totalRestocked = movements.filter(m => m.movementType === 'RESTOCKED').reduce((a, b) => a + b.quantity, 0);

  // Summary Metrics Bar
  doc.setFillColor(250, 248, 245);
  doc.roundedRect(14, 44, 269, 12, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(229, 72, 24);
  doc.text(`Total Units Dispatched to Site: ${totalIssued} units`, 18, 51.5);
  doc.setTextColor(43, 26, 112);
  doc.text(`Total Units Restocked: ${totalRestocked} units`, 130, 51.5);

  const tableHeaders = [
    ['Ref Code', 'Date', 'Type', 'Item Code', 'Item Description', 'Qty Moved', 'Site / Recipient', 'Issued By', 'Logged By', 'Notes']
  ];

  const tableRows = movements.map(m => [
    m.movementCode || 'N/A',
    m.date,
    m.movementType === 'ISSUED_OUT' ? 'DISPATCHED' : m.movementType === 'RESTOCKED' ? 'RESTOCKED' : 'ADJUSTED',
    m.itemCode,
    m.itemName,
    m.quantity,
    m.recipient || 'N/A',
    m.issuedBy || 'N/A',
    m.createdBy || 'system',
    m.notes || ''
  ]);

  autoTable(doc, {
    head: tableHeaders,
    body: tableRows,
    startY: 60,
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [30, 27, 75],
      lineColor: [225, 228, 235],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [43, 26, 112],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 22, fontStyle: 'bold' },
      1: { cellWidth: 20 },
      2: { cellWidth: 24, fontStyle: 'bold', halign: 'center' },
      3: { cellWidth: 20 },
      4: { cellWidth: 44 },
      5: { cellWidth: 18, halign: 'right', fontStyle: 'bold' },
      6: { cellWidth: 32 },
      7: { cellWidth: 30 },
      8: { cellWidth: 26 },
      9: { cellWidth: 33 }
    },
    alternateRowStyles: {
      fillColor: [250, 248, 245],
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 2) {
        const val = String(data.cell.raw);
        if (val === 'DISPATCHED') {
          data.cell.styles.textColor = [229, 72, 24];
        } else if (val === 'RESTOCKED') {
          data.cell.styles.textColor = [5, 150, 105];
        } else {
          data.cell.styles.textColor = [100, 100, 120];
        }
      }
    }
  });

  addDocumentFooter(doc);
  doc.save(`saka-homes-dispatches-${new Date().toISOString().split('T')[0]}.pdf`);
}

/**
 * 3. EXPORT PURCHASE ORDERS TO PDF TABLE
 */
export function exportPurchaseOrdersPDF(orders: PurchaseOrder[], dateLabel: string) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  addDocumentHeader(
    doc,
    'Purchase Orders & Procurement Log',
    `Total Purchase Orders: ${orders.length} procurement records`,
    dateLabel
  );

  const totalCost = orders.reduce((acc, o) => acc + (o.totalCost || 0), 0);

  // Summary Metrics Bar
  doc.setFillColor(250, 248, 245);
  doc.roundedRect(14, 44, 269, 12, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(43, 26, 112);
  doc.text(`Total Procurement Spend: ${formatPdfCurrency(totalCost)}`, 18, 51.5);
  doc.text(`Total Orders: ${orders.length}`, 130, 51.5);
  doc.setTextColor(5, 150, 105);
  doc.text(`Completed: ${orders.filter(o => o.status === 'COMPLETED').length}`, 180, 51.5);

  const tableHeaders = [
    ['PO Number', 'Order Date', 'Expected Date', 'Item Code', 'Item Name', 'Supplier', 'Qty', 'Unit Cost (GH\u00A2)', 'Total Cost (GH\u00A2)', 'Issued By', 'Status', 'Notes']
  ];

  const tableRows = orders.map(po => [
    po.poNumber || 'N/A',
    po.orderDate,
    po.expectedDate || 'N/A',
    po.itemCode || 'N/A',
    po.itemName,
    po.supplier,
    po.qtyOrdered,
    formatPdfCurrency(po.unitCost),
    formatPdfCurrency(po.totalCost),
    po.createdBy || 'admin',
    po.status,
    po.notes || ''
  ]);

  autoTable(doc, {
    head: tableHeaders,
    body: tableRows,
    startY: 60,
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [30, 27, 75],
      lineColor: [225, 228, 235],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [43, 26, 112],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 22, fontStyle: 'bold' },
      1: { cellWidth: 18 },
      2: { cellWidth: 18 },
      3: { cellWidth: 18 },
      4: { cellWidth: 38 },
      5: { cellWidth: 30 },
      6: { cellWidth: 14, halign: 'right' },
      7: { cellWidth: 22, halign: 'right' },
      8: { cellWidth: 25, halign: 'right', fontStyle: 'bold' },
      9: { cellWidth: 24 },
      10: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
      11: { cellWidth: 16 },
    },
    alternateRowStyles: {
      fillColor: [250, 248, 245],
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 10) {
        const val = String(data.cell.raw);
        if (val === 'COMPLETED' || val === 'RECEIVED') {
          data.cell.styles.textColor = [5, 150, 105];
        } else if (val === 'PENDING' || val === 'SENT') {
          data.cell.styles.textColor = [217, 119, 6];
        } else if (val === 'CANCELLED') {
          data.cell.styles.textColor = [225, 29, 72];
        } else {
          data.cell.styles.textColor = [100, 100, 120];
        }
      }
    },
    foot: [
      ['', '', '', '', 'GRAND TOTAL', '', orders.reduce((a, b) => a + b.qtyOrdered, 0), '', formatPdfCurrency(totalCost), '', '', '']
    ],
    footStyles: {
      fillColor: [229, 72, 24],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    }
  });

  addDocumentFooter(doc);
  doc.save(`saka-homes-purchase-orders-${new Date().toISOString().split('T')[0]}.pdf`);
}

/**
 * 4. EXPORT COMPREHENSIVE REPORTS TO PDF TABLES
 */
export function exportReportPDF(params: {
  reportData: Array<{
    category: string;
    totalItems: number;
    outOfStock: number;
    lowStock: number;
    inStock: number;
    totalValue: number;
  }>;
  totals: {
    totalItems: number;
    outOfStock: number;
    lowStock: number;
    inStock: number;
    totalValue: number;
  };
  movements: StockMovement[];
  pos: PurchaseOrder[];
  reportScope: string;
  dateLabel: string;
}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const { reportData, totals, movements, pos, reportScope, dateLabel } = params;

  addDocumentHeader(
    doc,
    'Executive Supply Chain Report',
    `Scope: ${reportScope === 'ALL' ? 'Full Operations Audit' : reportScope}`,
    dateLabel
  );

  let currentY = 48;

  // 1. Category Summary Table
  if (reportScope === 'ALL' || reportScope === 'CATEGORY_SUMMARY') {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(43, 26, 112);
    doc.text('1. Category Stock & Valuation Breakdown', 14, currentY);

    const catHeaders = [['Category', 'Total SKUs', 'In Stock', 'Low Stock', 'Out of Stock', 'Valuation (GH\u00A2)']];
    const catRows = reportData.map(r => [
      r.category,
      r.totalItems,
      r.inStock,
      r.lowStock,
      r.outOfStock,
      formatPdfCurrency(r.totalValue)
    ]);

    catRows.push([
      'GRAND TOTAL',
      String(totals.totalItems),
      String(totals.inStock),
      String(totals.lowStock),
      String(totals.outOfStock),
      formatPdfCurrency(totals.totalValue)
    ]);

    autoTable(doc, {
      head: catHeaders,
      body: catRows,
      startY: currentY + 3,
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 2 },
      headStyles: { fillColor: [43, 26, 112], textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 50, fontStyle: 'bold' },
        1: { cellWidth: 25, halign: 'center' },
        2: { cellWidth: 25, halign: 'center' },
        3: { cellWidth: 25, halign: 'center' },
        4: { cellWidth: 25, halign: 'center' },
        5: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
      },
      didParseCell: (data) => {
        if (data.row.index === catRows.length - 1) {
          data.cell.styles.fillColor = [229, 72, 24];
          data.cell.styles.textColor = [255, 255, 255];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });

    currentY = (doc as any).lastAutoTable.finalY + 12;
  }

  // 2. Stock Movements Table
  if (reportScope === 'ALL' || reportScope === 'MOVEMENTS') {
    if (currentY > 230) {
      doc.addPage();
      currentY = 20;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(43, 26, 112);
    doc.text(`2. Site Dispatches & Material Movements (${movements.length} records)`, 14, currentY);

    const movHeaders = [['Ref Code', 'Date', 'Type', 'Item Name', 'Qty', 'Site / Recipient', 'Issued By']];
    const movRows = movements.slice(0, 50).map(m => [
      m.movementCode || 'N/A',
      m.date,
      m.movementType === 'ISSUED_OUT' ? 'DISPATCH' : m.movementType,
      m.itemName,
      m.quantity,
      m.recipient || 'N/A',
      m.issuedBy || m.createdBy || 'Admin'
    ]);

    autoTable(doc, {
      head: movHeaders,
      body: movRows,
      startY: currentY + 3,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [43, 26, 112], textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 24, fontStyle: 'bold' },
        1: { cellWidth: 20 },
        2: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
        3: { cellWidth: 42 },
        4: { cellWidth: 16, halign: 'right', fontStyle: 'bold' },
        5: { cellWidth: 30 },
        6: { cellWidth: 28 },
      }
    });

    currentY = (doc as any).lastAutoTable.finalY + 12;
  }

  // 3. Purchase Orders Table
  if (reportScope === 'ALL' || reportScope === 'PURCHASE_ORDERS') {
    if (currentY > 230) {
      doc.addPage();
      currentY = 20;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(43, 26, 112);
    doc.text(`3. Purchase Orders Log (${pos.length} records)`, 14, currentY);

    const poHeaders = [['PO Number', 'Order Date', 'Item Name', 'Supplier', 'Qty', 'Total (GH\u00A2)', 'Issued By', 'Status']];
    const poRows = pos.slice(0, 50).map(p => [
      p.poNumber || 'N/A',
      p.orderDate,
      p.itemName,
      p.supplier,
      p.qtyOrdered,
      formatPdfCurrency(p.totalCost),
      p.createdBy || 'Admin',
      p.status
    ]);

    autoTable(doc, {
      head: poHeaders,
      body: poRows,
      startY: currentY + 3,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [43, 26, 112], textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 24, fontStyle: 'bold' },
        1: { cellWidth: 20 },
        2: { cellWidth: 38 },
        3: { cellWidth: 30 },
        4: { cellWidth: 14, halign: 'right' },
        5: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
        6: { cellWidth: 24 },
        7: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
      }
    });
  }

  addDocumentFooter(doc);
  doc.save(`saka-homes-executive-report-${new Date().toISOString().split('T')[0]}.pdf`);
}

function PrimaryPurpleToRGB(): [number, number, number] {
  return [43, 26, 112];
}
