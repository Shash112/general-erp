import React from 'react';

export interface EditableLineItem {
  productId: string;
  productCode: string;
  productName: string;
  uom: string;
  quantity: number | string;
  unitPrice: number | string;
  discountPercent: number | string;
  pricingSource?: string;
  description?: string;
}

export interface QuotationLineEditorProps {
  lines: EditableLineItem[];
  onChange: (lines: EditableLineItem[]) => void;
  isReadOnly?: boolean;
}

export function QuotationLineEditor({ lines, onChange, isReadOnly = false }: QuotationLineEditorProps) {

  const handleAddLine = () => {
    onChange([
      ...lines,
      {
        productId: 'prod_demo_1',
        productCode: 'PROD-BEAR-01',
        productName: 'Industrial Roller Bearing 50mm',
        uom: 'PCS',
        quantity: 10,
        unitPrice: 1500.0,
        discountPercent: 0.0,
        pricingSource: 'PRODUCT_DEFAULT'
      }
    ]);
  };

  const handleRemoveLine = (index: number) => {
    const updated = [...lines];
    updated.splice(index, 1);
    onChange(updated);
  };

  const handleLineFieldChange = (index: number, field: keyof EditableLineItem, val: any) => {
    const updated = [...lines];
    updated[index] = { ...updated[index]!, [field]: val };
    onChange(updated);
  };

  return (
    <div style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', color: '#1e293b' }}>Quotation Line Items</h3>
        {!isReadOnly && (
          <button
            type="button"
            onClick={handleAddLine}
            style={{ backgroundColor: '#2563eb', color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
          >
            + Add Product Line
          </button>
        )}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ backgroundColor: '#f1f5f9', textAlign: 'left', color: '#334155' }}>
            <th style={{ padding: '0.5rem', border: '1px solid #cbd5e1', width: '40px' }}>#</th>
            <th style={{ padding: '0.5rem', border: '1px solid #cbd5e1' }}>Product Details</th>
            <th style={{ padding: '0.5rem', border: '1px solid #cbd5e1', width: '70px' }}>UOM</th>
            <th style={{ padding: '0.5rem', border: '1px solid #cbd5e1', width: '90px' }}>Qty</th>
            <th style={{ padding: '0.5rem', border: '1px solid #cbd5e1', width: '110px' }}>Unit Price (₹)</th>
            <th style={{ padding: '0.5rem', border: '1px solid #cbd5e1', width: '80px' }}>Disc %</th>
            <th style={{ padding: '0.5rem', border: '1px solid #cbd5e1', width: '110px' }}>Source</th>
            {!isReadOnly && <th style={{ padding: '0.5rem', border: '1px solid #cbd5e1', width: '60px' }}>Action</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, idx) => (
            <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
              <td style={{ padding: '0.5rem', border: '1px solid #e2e8f0', fontWeight: 600, textAlign: 'center' }}>{idx + 1}</td>
              <td style={{ padding: '0.5rem', border: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: 600, color: '#1e293b' }}>{line.productCode} — {line.productName}</div>
                {!isReadOnly ? (
                  <input
                    type="text"
                    placeholder="Custom line specs/notes"
                    value={line.description || ''}
                    onChange={e => handleLineFieldChange(idx, 'description', e.target.value)}
                    style={{ width: '100%', padding: '0.2rem', marginTop: '0.2rem', fontSize: '0.75rem', border: '1px solid #cbd5e1', borderRadius: '3px' }}
                  />
                ) : (
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{line.description}</div>
                )}
              </td>
              <td style={{ padding: '0.5rem', border: '1px solid #e2e8f0' }}>{line.uom}</td>
              <td style={{ padding: '0.5rem', border: '1px solid #e2e8f0' }}>
                {!isReadOnly ? (
                  <input
                    type="number"
                    min="1"
                    value={line.quantity}
                    onChange={e => handleLineFieldChange(idx, 'quantity', Number(e.target.value))}
                    style={{ width: '100%', padding: '0.3rem', fontSize: '0.85rem' }}
                  />
                ) : (
                  line.quantity
                )}
              </td>
              <td style={{ padding: '0.5rem', border: '1px solid #e2e8f0' }}>
                {!isReadOnly ? (
                  <input
                    type="number"
                    step="0.01"
                    value={line.unitPrice}
                    onChange={e => {
                      handleLineFieldChange(idx, 'unitPrice', Number(e.target.value));
                      handleLineFieldChange(idx, 'pricingSource', 'MANUAL');
                    }}
                    style={{ width: '100%', padding: '0.3rem', fontSize: '0.85rem' }}
                  />
                ) : (
                  `₹${Number(line.unitPrice).toFixed(2)}`
                )}
              </td>
              <td style={{ padding: '0.5rem', border: '1px solid #e2e8f0' }}>
                {!isReadOnly ? (
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={line.discountPercent}
                    onChange={e => handleLineFieldChange(idx, 'discountPercent', Number(e.target.value))}
                    style={{ width: '100%', padding: '0.3rem', fontSize: '0.85rem' }}
                  />
                ) : (
                  `${line.discountPercent}%`
                )}
              </td>
              <td style={{ padding: '0.5rem', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem', borderRadius: '3px', backgroundColor: line.pricingSource === 'MANUAL' ? '#fef3c7' : '#e0f2fe', color: line.pricingSource === 'MANUAL' ? '#92400e' : '#0369a1', fontWeight: 600 }}>
                  {line.pricingSource || 'PRODUCT_DEFAULT'}
                </span>
              </td>
              {!isReadOnly && (
                <td style={{ padding: '0.5rem', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={() => handleRemoveLine(idx)}
                    style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
                  >
                    ✕
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default QuotationLineEditor;
