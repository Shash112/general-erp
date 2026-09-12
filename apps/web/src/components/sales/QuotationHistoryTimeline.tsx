import React from 'react';

export interface AuditEventItem {
  timestamp: string;
  action: string;
  actor: string;
  details?: string;
}

export interface QuotationHistoryTimelineProps {
  quotationNumber: string;
  revisionNumber: number;
  events?: AuditEventItem[];
}

export function QuotationHistoryTimeline({ quotationNumber, revisionNumber, events = [] }: QuotationHistoryTimelineProps) {
  const defaultEvents: AuditEventItem[] = [
    { timestamp: '2026-09-12 10:00:00', action: 'CREATE', actor: 'Sales Representative', details: 'Created draft quotation' },
    { timestamp: '2026-09-12 10:05:00', action: 'SUBMIT_FOR_APPROVAL', actor: 'Sales Representative', details: 'Submitted quote for manager review' },
    { timestamp: '2026-09-12 10:10:00', action: 'APPROVE', actor: 'Sales Manager', details: 'Approved discount threshold' },
    { timestamp: '2026-09-12 10:12:00', action: 'SEND', actor: 'Sales Representative', details: 'Sent proposal; address & tax snapshots frozen' }
  ];

  const list = events.length > 0 ? events : defaultEvents;

  return (
    <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '1rem', marginTop: '1.5rem' }}>
      <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#1e293b', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.4rem' }}>
        Audit Trail & Revision History ({quotationNumber} — Rev {revisionNumber})
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem' }}>
        {list.map((ev, idx) => (
          <div key={idx} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
            <span style={{ color: '#94a3b8', width: '130px', flexShrink: 0 }}>{ev.timestamp}</span>
            <span style={{ fontWeight: 600, color: '#2563eb', width: '150px', flexShrink: 0 }}>{ev.action}</span>
            <span style={{ color: '#475569', fontWeight: 500, width: '140px', flexShrink: 0 }}>{ev.actor}</span>
            <span style={{ color: '#64748b' }}>{ev.details}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default QuotationHistoryTimeline;
