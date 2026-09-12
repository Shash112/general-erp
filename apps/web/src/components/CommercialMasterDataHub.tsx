import React, { useState } from 'react';

export function CommercialMasterDataHub() {
  const [activeTab, setActiveTab] = useState<'products' | 'customers' | 'suppliers' | 'uom_pricing' | 'import'>('products');

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: '1200px', margin: '0 auto', padding: '1rem' }}>
      <header style={{ borderBottom: '2px solid #e2e8f0', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, color: '#1e293b', fontSize: '1.75rem' }}>Commercial Master Data Hub</h1>
        <p style={{ margin: '0.25rem 0 0 0', color: '#64748b', fontSize: '0.9rem' }}>
          Phase 3.0 Shared Commercial Foundation: Products, Customers, Suppliers, UOM, Pricing & Bulk Import
        </p>
      </header>

      {/* Navigation Tabs */}
      <nav style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid #cbd5e1' }}>
        <button
          onClick={() => setActiveTab('products')}
          style={{
            padding: '0.6rem 1.2rem',
            border: 'none',
            borderBottom: activeTab === 'products' ? '3px solid #2563eb' : '3px solid transparent',
            background: 'none',
            fontWeight: activeTab === 'products' ? 600 : 400,
            color: activeTab === 'products' ? '#2563eb' : '#475569',
            cursor: 'pointer'
          }}
        >
          Product Master
        </button>

        <button
          onClick={() => setActiveTab('customers')}
          style={{
            padding: '0.6rem 1.2rem',
            border: 'none',
            borderBottom: activeTab === 'customers' ? '3px solid #2563eb' : '3px solid transparent',
            background: 'none',
            fontWeight: activeTab === 'customers' ? 600 : 400,
            color: activeTab === 'customers' ? '#2563eb' : '#475569',
            cursor: 'pointer'
          }}
        >
          Customer Master
        </button>

        <button
          onClick={() => setActiveTab('suppliers')}
          style={{
            padding: '0.6rem 1.2rem',
            border: 'none',
            borderBottom: activeTab === 'suppliers' ? '3px solid #2563eb' : '3px solid transparent',
            background: 'none',
            fontWeight: activeTab === 'suppliers' ? 600 : 400,
            color: activeTab === 'suppliers' ? '#2563eb' : '#475569',
            cursor: 'pointer'
          }}
        >
          Supplier Master
        </button>

        <button
          onClick={() => setActiveTab('uom_pricing')}
          style={{
            padding: '0.6rem 1.2rem',
            border: 'none',
            borderBottom: activeTab === 'uom_pricing' ? '3px solid #2563eb' : '3px solid transparent',
            background: 'none',
            fontWeight: activeTab === 'uom_pricing' ? 600 : 400,
            color: activeTab === 'uom_pricing' ? '#2563eb' : '#475569',
            cursor: 'pointer'
          }}
        >
          UOM & Pricing Engine
        </button>

        <button
          onClick={() => setActiveTab('import')}
          style={{
            padding: '0.6rem 1.2rem',
            border: 'none',
            borderBottom: activeTab === 'import' ? '3px solid #2563eb' : '3px solid transparent',
            background: 'none',
            fontWeight: activeTab === 'import' ? 600 : 400,
            color: activeTab === 'import' ? '#2563eb' : '#475569',
            cursor: 'pointer'
          }}
        >
          Bulk Import Workbench
        </button>
      </nav>

      {/* Tab Panels */}
      <main style={{ backgroundColor: '#ffffff', borderRadius: '8px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        {activeTab === 'products' && (
          <div>
            <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.25rem', color: '#1e293b' }}>Product Directory & Form</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.5rem' }}>
              <form style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', backgroundColor: '#f8fafc', padding: '1rem', borderRadius: '6px' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
                  Product Code
                  <input type="text" placeholder="PROD-001" style={{ width: '100%', padding: '0.4rem', marginTop: '0.2rem' }} />
                </label>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
                  Product Name
                  <input type="text" placeholder="Industrial Bearing" style={{ width: '100%', padding: '0.4rem', marginTop: '0.2rem' }} />
                </label>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
                  SKU
                  <input type="text" placeholder="SKU-BEAR-01" style={{ width: '100%', padding: '0.4rem', marginTop: '0.2rem' }} />
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <label style={{ flex: 1, fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
                    Selling Price (₹)
                    <input type="text" placeholder="1500.00" style={{ width: '100%', padding: '0.4rem', marginTop: '0.2rem' }} />
                  </label>
                  <label style={{ flex: 1, fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
                    Base UOM
                    <input type="text" placeholder="PCS" style={{ width: '100%', padding: '0.4rem', marginTop: '0.2rem' }} />
                  </label>
                </div>
                <button type="button" style={{ backgroundColor: '#2563eb', color: '#fff', border: 'none', padding: '0.5rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, marginTop: '0.5rem' }}>
                  Create Product
                </button>
              </form>

              <div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f1f5f9', textAlign: 'left' }}>
                      <th style={{ padding: '0.5rem', border: '1px solid #e2e8f0' }}>Code</th>
                      <th style={{ padding: '0.5rem', border: '1px solid #e2e8f0' }}>Name</th>
                      <th style={{ padding: '0.5rem', border: '1px solid #e2e8f0' }}>SKU</th>
                      <th style={{ padding: '0.5rem', border: '1px solid #e2e8f0' }}>Selling Price</th>
                      <th style={{ padding: '0.5rem', border: '1px solid #e2e8f0' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: '0.5rem', border: '1px solid #e2e8f0' }}>PROD-DEMO-1</td>
                      <td style={{ padding: '0.5rem', border: '1px solid #e2e8f0' }}>Demo Commercial Product</td>
                      <td style={{ padding: '0.5rem', border: '1px solid #e2e8f0' }}>SKU-DEMO-1</td>
                      <td style={{ padding: '0.5rem', border: '1px solid #e2e8f0' }}>₹1,250.00</td>
                      <td style={{ padding: '0.5rem', border: '1px solid #e2e8f0', color: '#16a34a', fontWeight: 600 }}>Active</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'customers' && (
          <div>
            <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.25rem', color: '#1e293b' }}>Customer Master & Billing/Shipping Addresses</h2>
            <p style={{ color: '#64748b' }}>Manage customer profiles, GST classifications, credit limits, and multiple shipping/billing addresses.</p>
          </div>
        )}

        {activeTab === 'suppliers' && (
          <div>
            <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.25rem', color: '#1e293b' }}>Supplier Master & Tax Metadata</h2>
            <p style={{ color: '#64748b' }}>Manage vendor profiles, MSME classifications (Micro/Small/Medium), TDS sections, and contacts.</p>
          </div>
        )}

        {activeTab === 'uom_pricing' && (
          <div>
            <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.25rem', color: '#1e293b' }}>UOM Conversions & Pricing Resolution Cascade</h2>
            <p style={{ color: '#64748b' }}>Cascade: Entity Override → Price List Rule → Volume Tier → Master Product Price.</p>
          </div>
        )}

        {activeTab === 'import' && (
          <div>
            <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.25rem', color: '#1e293b' }}>Commercial Master Data Bulk Import Workbench</h2>
            <div style={{ padding: '1rem', border: '2px dashed #cbd5e1', borderRadius: '6px', textAlign: 'center', backgroundColor: '#f8fafc' }}>
              <p style={{ margin: 0, fontWeight: 600, color: '#475569' }}>Drop CSV/JSON files here or select entity type to import</p>
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                Supported Entities: Product, Customer, Supplier | Maximum limit: 500 records per request | Single Atomic Transaction Rollback
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default CommercialMasterDataHub;
