import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { motion, AnimatePresence } from 'framer-motion';
import { Filter, Calendar, File, X, ChevronDown, ChevronUp } from 'lucide-react';

const MONTHS = [
  { value: '01', label: 'Jan' },
  { value: '02', label: 'Feb' },
  { value: '03', label: 'Mar' },
  { value: '04', label: 'Apr' },
  { value: '05', label: 'May' },
  { value: '06', label: 'Jun' },
  { value: '07', label: 'Jul' },
  { value: '08', label: 'Aug' },
  { value: '09', label: 'Sep' },
  { value: '10', label: 'Oct' },
  { value: '11', label: 'Nov' },
  { value: '12', label: 'Dec' },
];

const TYPES = [
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Audio' },
  { value: 'document', label: 'Documents' },
  { value: 'code', label: 'Code' },
  { value: 'other', label: 'Others' },
];

export function FilterBox() {
  const { state, dispatch } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const activeFilters = state.filters;

  if (state.sidebarCollapsed) return null;

  const hasActiveFilters = activeFilters.months.length > 0 || activeFilters.types.length > 0;

  const handleToggleMonth = (month: string) => {
    dispatch({ type: 'TOGGLE_FILTER_MONTH', month });
  };

  const handleToggleType = (fileType: string) => {
    dispatch({ type: 'TOGGLE_FILTER_TYPE', fileType });
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: 'CLEAR_FILTERS' });
  };

  return (
    <div className="filter-box-container">
      <button 
        className={`filter-box__header ${isOpen ? 'filter-box__header--open' : ''} ${hasActiveFilters ? 'filter-box__header--active' : ''}`}
        onClick={() => setIsOpen(o => !o)}
      >
        <span className="filter-box__title">
          <Filter size={14} className={hasActiveFilters ? 'animate-pulse text-blue-400' : ''} />
          <span>Filters</span>
          {hasActiveFilters && (
            <span className="filter-badge">
              {activeFilters.months.length + activeFilters.types.length}
            </span>
          )}
        </span>
        <div className="filter-box__header-actions">
          {hasActiveFilters && (
            <span className="filter-clear-btn" onClick={handleClear} title="Clear Filters">
              <X size={12} />
            </span>
          )}
          {isOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className="filter-box__drawer"
          >
            {/* File Types Section */}
            <div className="filter-section">
              <div className="filter-section__title">
                <File size={12} />
                <span>File Type</span>
              </div>
              <div className="filter-types-grid">
                {TYPES.map(t => {
                  const active = activeFilters.types.includes(t.value);
                  return (
                    <button
                      key={t.value}
                      className={`filter-chip ${active ? 'filter-chip--active' : ''}`}
                      onClick={() => handleToggleType(t.value)}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Months Section */}
            <div className="filter-section">
              <div className="filter-section__title">
                <Calendar size={12} />
                <span>Date Modified</span>
              </div>
              <div className="filter-months-grid">
                {MONTHS.map(m => {
                  const active = activeFilters.months.includes(m.value);
                  return (
                    <button
                      key={m.value}
                      className={`filter-chip filter-chip--month ${active ? 'filter-chip--active' : ''}`}
                      onClick={() => handleToggleMonth(m.value)}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
