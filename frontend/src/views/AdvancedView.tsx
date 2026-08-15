import React from 'react';
import { AdvancedGenPanel } from './AdvancedGenPanel';

export const AdvancedView: React.FC = () => {
  return (
    <div className="h-full w-full overflow-hidden relative">
      <div className="absolute inset-0">
        <AdvancedGenPanel />
      </div>
    </div>
  );
};
