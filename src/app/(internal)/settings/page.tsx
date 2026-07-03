'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Plus, ShieldCheck } from 'lucide-react';
import { useCapex } from '@/lib/capexContext';
import { PLANTS, ROLE_NAMES } from '@/lib/constants';
import { CARD } from '@/lib/uiTokens';

type Tab = 'plants' | 'categories' | 'users' | 'system';

export default function SettingsPage() {
  const router = useRouter();
  const { plants, categories, customPlants, addCustomPlant, removePlant, addCategory, removeCategory, resetData } = useCapex();

  const [activeTab, setActiveTab] = useState<Tab>('plants');

  // New plant form state
  const [newPlantLabel, setNewPlantLabel] = useState('');
  const [newPlantState, setNewPlantState] = useState('');

  // New category form state
  const [newCategory, setNewCategory] = useState('');
  const [resetConfirm, setResetConfirm] = useState(false);

  useEffect(() => {
    const role = localStorage.getItem('capex_role');
    if (role !== 'super_admin') {
      router.replace('/capex/requests');
    }
  }, [router]);

  function handleAddPlant() {
    const label = newPlantLabel.trim();
    const state = newPlantState.trim();
    if (!label) return;
    const value = label.toLowerCase().replace(/\s+/g, '_');
    addCustomPlant({ value, label, state });
    setNewPlantLabel('');
    setNewPlantState('');
  }

  function handleAddCategory() {
    const name = newCategory.trim();
    if (!name) return;
    addCategory(name);
    setNewCategory('');
  }

  function plantLabel(value: string): string {
    const custom = customPlants.find((p) => p.value === value);
    if (custom) return `${custom.label}${custom.state ? ` (${custom.state})` : ''}`;
    const found = PLANTS.find((p) => p.value === value);
    return found ? `${found.label} (${found.state})` : value;
  }

  function handleReset() {
    resetData();
    setResetConfirm(false);
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'plants',     label: 'Plants' },
    { key: 'categories', label: 'Categories' },
    { key: 'users',      label: 'Users' },
    { key: 'system',     label: 'System' },
  ];

  return (
    <div className="p-5 max-w-3xl mx-auto space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-900">Configurations</h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
              <ShieldCheck className="w-3 h-3" />
              Super Admin Only
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">Manage plants, categories, and system users</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'border-slate-600 text-slate-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Plants Tab */}
      {activeTab === 'plants' && (
        <div className={`${CARD} space-y-3`}>
          <h2 className="text-sm font-semibold text-slate-700">Configured Plants</h2>

          {plants.length === 0 && (
            <p className="text-sm text-slate-400">No plants configured.</p>
          )}

          <ul className="divide-y divide-slate-100">
            {plants.map((value) => (
              <li key={value} className="flex items-center justify-between py-2">
                <span className="text-sm text-slate-800">{plantLabel(value)}</span>
                <button
                  onClick={() => removePlant(value)}
                  className="text-slate-400 hover:text-red-500 transition-colors p-1 rounded"
                  aria-label={`Remove plant ${value}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>

          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Add Plant
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Plant name (e.g. Mumbai)"
                value={newPlantLabel}
                onChange={(e) => setNewPlantLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddPlant()}
                className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
              <input
                type="text"
                placeholder="State (e.g. Maharashtra)"
                value={newPlantState}
                onChange={(e) => setNewPlantState(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddPlant()}
                className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
              <button
                onClick={handleAddPlant}
                disabled={!newPlantLabel.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-600 hover:bg-slate-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Categories Tab */}
      {activeTab === 'categories' && (
        <div className={`${CARD} space-y-3`}>
          <h2 className="text-sm font-semibold text-slate-700">Configured Categories</h2>

          {categories.length === 0 && (
            <p className="text-sm text-slate-400">No categories configured.</p>
          )}

          <ul className="divide-y divide-slate-100">
            {categories.map((name) => (
              <li key={name} className="flex items-center justify-between py-2">
                <span className="text-sm text-slate-800">{name}</span>
                <button
                  onClick={() => removeCategory(name)}
                  className="text-slate-400 hover:text-red-500 transition-colors p-1 rounded"
                  aria-label={`Remove category ${name}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>

          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Add Category
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Category name (e.g. Civil Works)"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
              <button
                onClick={handleAddCategory}
                disabled={!newCategory.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-600 hover:bg-slate-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* System Tab */}
      {activeTab === 'system' && (
        <div className="space-y-3">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-red-800">Danger Zone</h2>
              <p className="text-sm text-red-700 mt-1">
                Clears all requests, vendors, invites, quotes, and chat data from local storage and reloads the app with seed data. This cannot be undone.
              </p>
            </div>
            {resetConfirm ? (
              <div className="pt-1 space-y-3">
                <p className="text-sm font-medium text-red-800">Are you sure? All data will be lost.</p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleReset}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    Yes, Reset Everything
                  </button>
                  <button
                    onClick={() => setResetConfirm(false)}
                    className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setResetConfirm(true)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Reset All Data
              </button>
            )}
          </div>
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className={`${CARD} space-y-3`}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">System Users</h2>
            <span className="text-xs text-slate-400">Display only — managed via backend</span>
          </div>

          <ul className="divide-y divide-slate-100">
            {Object.entries(ROLE_NAMES).map(([role, name]) => (
              <li key={role} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{role}</p>
                </div>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                  {role === 'super_admin'
                    ? 'Super Admin'
                    : role === 'sourcing_head'
                    ? 'Sourcing Head'
                    : role === 'buyer'
                    ? 'Buyer'
                    : 'Sourcing Member'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
