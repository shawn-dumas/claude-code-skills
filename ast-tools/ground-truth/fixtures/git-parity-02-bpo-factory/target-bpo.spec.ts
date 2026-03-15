import { defineSettingsCrudTests } from './settings-crud.factory';

defineSettingsCrudTests({
  entityLabel: 'BPO',
  settingsTab: 'BPO',
  cellTestId: 'bpo-table-cell',
  existingEntityName: 'Acme BPO',
});
