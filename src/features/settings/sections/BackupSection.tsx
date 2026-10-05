import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';
import { EmptyState } from '@/components/EmptyState';
import { NumberField } from '@/components/NumberField';
import { SettingsField } from '../SettingsField';
import { sl } from '../settingsCopy';
import { backupRepo } from '@/db/repo/backupRepo';
import { messageRepo } from '@/db/repo/messageRepo';
import { sessionRepo } from '@/db/repo/sessionRepo';
import { useLogStore } from '@/store/logStore';
import { useMemoryStore } from '@/store/memoryStore';
import { usePersonaStore } from '@/store/personaStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSnack } from '@/hooks/useSnack';
import { zipAndDownload, unzipFile, readZipText, strFromU8 } from '@/lib/zip';
import { formatBytes } from '@/lib/file';
import { formatAgo } from '@/lib/time';
import { DEFAULT_BACKUP_KEEP } from '@/constants/limits';
import { migrateSettings } from '@/constants/defaults';
import { t } from '@/copy';
import type { BackupMeta } from '@/types/backup';
import type { PersonaCard } from '@/types/persona';

/**
 * 备份分组（FN-02 一键导入 / FN-03 一键导出 / FN-47 自动备份）。
 *
 * ★ 导出产物是**本地 zip**（`AppBackupBundle` 的目录约定见 `types/backup.ts`），
 *   全程不碰网络；自动备份走 `backupRepo.snapshot()` 存快照，保留 N 份（SV-08 同口径）。
 */
export function BackupSection(): JSX.Element {
  const snack = useSnack();
  const chat = useSettingsStore((s) => s.settings.chat);
  const setChat = useSettingsStore((s) => s.setChat);
  const settings = useSettingsStore((s) => s.settings);
  const patch = useSettingsStore((s) => s.patch);

  const personas = usePersonaStore((s) => s.personas);
  const importCards = usePersonaStore((s) => s.importCards);
  const reloadPersonas = usePersonaStore((s) => s.reload);
  const memories = useMemoryStore((s) => s.entries);
  const exportLogs = useLogStore((s) => s.exportJSONL);

  const [busy, setBusy] = useState<boolean>(false);
  const [snapshots, setSnapshots] = useState<BackupMeta[]>([]);

  const loadSnapshots = useCallback(async (): Promise<void> => {
    const res = await backupRepo.listRecent(20);
    if (res.ok) setSnapshots(res.value);
  }, []);

  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);

  /** —— FN-03 一键导出：打包成本地 zip —— */
  const handleExport = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const sessions = await sessionRepo.list();
      const files: Record<string, string> = {
        'settings.json': JSON.stringify(settings, null, 2),
        'memories.json': JSON.stringify(memories, null, 2),
        'logs.jsonl': exportLogs(),
        'meta.json': JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            counts: {
              sessions: sessions.ok ? sessions.value.length : 0,
              personas: personas.length,
              memories: memories.length,
            },
          },
          null,
          2,
        ),
      };
      for (const card of personas) {
        files[`personas/${card.id}.json`] = JSON.stringify(card, null, 2);
      }
      if (sessions.ok) {
        for (const s of sessions.value) {
          files[`sessions/${s.id}.json`] = JSON.stringify(s, null, 2);
        }
      }
      zipAndDownload(files, `ai-ai-backup-${Date.now()}.zip`);
      snack.success('ok.exported');
    } catch {
      snack.error('err.dbFailed');
    } finally {
      setBusy(false);
    }
  }, [settings, memories, personas, exportLogs, snack]);

  /** —— FN-02 一键导入：zip 或单个 json —— */
  const handleImport = useCallback(
    async (file: File): Promise<void> => {
      setBusy(true);
      try {
        let settingsText: string | undefined;
        const cards: PersonaCard[] = [];

        if (file.name.toLowerCase().endsWith('.zip')) {
          const files = await unzipFile(file);
          settingsText = readZipText(files, 'settings.json');
          for (const [path, bytes] of files) {
            if (!path.startsWith('personas/') || !path.endsWith('.json')) continue;
            try {
              cards.push(JSON.parse(strFromU8(bytes)) as PersonaCard);
            } catch {
              /* 单张卡坏了不影响其它卡 */
            }
          }
        } else {
          settingsText = await file.text();
        }

        if (settingsText) {
          // 迁移补齐字段后再写回，避免旧版本备份把新字段冲成 undefined
          patch(migrateSettings(JSON.parse(settingsText)));
        }
        if (cards.length > 0) {
          await importCards(cards);
          await reloadPersonas();
        }
        snack.success('ok.imported');
      } catch {
        snack.error('err.importInvalid');
      } finally {
        setBusy(false);
      }
    },
    [patch, importCards, reloadPersonas, snack],
  );

  /** —— FN-47 立即备份：写一份快照 —— */
  const handleSnapshot = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const [sessionCount, messageCount] = await Promise.all([
        sessionRepo.count(),
        messageRepo.count(),
      ]);
      const res = await backupRepo.snapshot({
        appVersion: '0.1.0',
        kind: 'manual',
        counts: {
          sessions: sessionCount.ok ? sessionCount.value : 0,
          messages: messageCount.ok ? messageCount.value : 0,
          personas: personas.length,
          memories: memories.length,
        },
        sizeBytes: 0,
      });
      if (!res.ok) {
        snack.error('err.dbFailed');
        return;
      }
      await backupRepo.prune(chat.autoBackup.keep || DEFAULT_BACKUP_KEEP, 'manual');
      await loadSnapshots();
      snack.success('ok.backupDone');
    } catch {
      snack.error('err.dbFailed');
    } finally {
      setBusy(false);
    }
  }, [personas.length, memories.length, chat.autoBackup.keep, loadSnapshots, snack]);

  const handleRemoveSnapshot = useCallback(
    async (id: string): Promise<void> => {
      const res = await backupRepo.remove(id);
      if (!res.ok) {
        snack.error('err.dbFailed');
        return;
      }
      await loadSnapshots();
      snack.success('ok.deleted');
    },
    [loadSnapshots, snack],
  );

  return (
    <Box>
      {/* —— FN-02 一键导入 —— */}
      <SettingsField labelKey="label.import" hintKey="hint.import" featureId="FN-02">
        <Stack direction="row" spacing={1} alignItems="center">
          {busy ? <CircularProgress size={20} /> : null}
          <Button
            variant="outlined"
            component="label"
            startIcon={<UploadIcon />}
            disabled={busy}
            sx={{ minHeight: 44 }}
          >
            {t('common.import')}
            <input
              hidden
              type="file"
              accept=".zip,.json,application/zip,application/json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handleImport(file);
              }}
            />
          </Button>
        </Stack>
      </SettingsField>

      {/* —— FN-03 一键导出 —— */}
      <SettingsField labelKey="label.export" hintKey="hint.export" featureId="FN-03">
        <Button
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={() => void handleExport()}
          disabled={busy}
          sx={{ minHeight: 44 }}
        >
          {t('common.export')}
        </Button>
      </SettingsField>

      {/* —— FN-47 自动备份 —— */}
      <SettingsField labelKey="label.autoBackup" hintCopyKey="settings.hint.autoBackup" featureId="FN-47">
        <Switch
          checked={chat.autoBackup.enabled}
          onChange={(e) => setChat({ autoBackup: { enabled: e.target.checked } })}
        />
      </SettingsField>
      <SettingsField labelKey="label.backupInterval" hintKey="hint.backupInterval" nested featureId="FN-47">
        <NumberField
          value={chat.autoBackup.intervalHour}
          onChange={(v) => setChat({ autoBackup: { intervalHour: v } })}
          min={1}
          max={720}
          step={1}
          presets={[6, 12, 24, 72]}
          disabled={!chat.autoBackup.enabled}
          width={110}
        />
      </SettingsField>
      <SettingsField labelKey="label.backupKeep" hintKey="hint.backupKeep" nested featureId="FN-47">
        <NumberField
          value={chat.autoBackup.keep}
          onChange={(v) => setChat({ autoBackup: { keep: v } })}
          min={1}
          max={50}
          step={1}
          presets={[3, 5, 10, 20]}
          disabled={!chat.autoBackup.enabled}
          width={110}
        />
      </SettingsField>

      {/* 立即备份 */}
      <SettingsField labelKey="label.backupNow" hintKey="hint.backupNow" featureId="FN-47">
        <Button variant="contained" onClick={() => void handleSnapshot()} disabled={busy} sx={{ minHeight: 44 }}>
          {t('common.save')}
        </Button>
      </SettingsField>

      {/* 快照列表 */}
      <Box sx={{ pt: 1.5 }}>
        <Divider />
        <Typography variant="subtitle2" sx={{ fontWeight: 700, py: 1 }}>
          {sl('label.backupList')}
        </Typography>
        {snapshots.length === 0 ? (
          <EmptyState descKey="empty.backups" dense />
        ) : (
          <Stack spacing={0.5}>
            {snapshots.map((s) => (
              <Stack
                key={s.id}
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ minHeight: 44 }}
              >
                <Chip
                  size="small"
                  variant={s.kind === 'auto' ? 'outlined' : 'filled'}
                  label={s.kind === 'auto' ? 'auto' : 'manual'}
                  sx={{ fontFamily: 'monospace' }}
                />
                <Typography variant="caption" sx={{ opacity: 0.75, minWidth: 90 }}>
                  {formatAgo(s.createdAt)}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.6, flex: 1 }}>
                  {`${s.counts.sessions} / ${s.counts.messages} / ${s.counts.personas} / ${s.counts.memories} · ${formatBytes(s.sizeBytes)}`}
                </Typography>
                <IconButton
                  size="small"
                  onClick={() => void handleRemoveSnapshot(s.id)}
                  sx={{ minWidth: 44, minHeight: 44 }}
                  aria-label={t('common.delete')}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}

export default BackupSection;
