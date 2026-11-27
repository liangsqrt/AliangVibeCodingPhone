import React, { useEffect, useState } from 'react';
import { AppState, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '../shared/BottomSheet';
import { formatBytes } from '../../utils/format';
import { useTheme } from '../../theme/useTheme';
import { isActiveOperation, operationElapsedLabel, operationPercent, type Operation } from '../../api/operations';
import { useControlCenterStore } from '../../store/controlCenterStore';

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId?: string;
  initialSource?: string;
  onOpenSubagents?: () => void;
  onOpenSession: (id: string) => void;
}

export function OperationActivitySheet({ open, onClose, sessionId, initialSource, onOpenSession, onOpenSubagents }: Props) {
  const { t } = useTranslation('operations');
  const { theme } = useTheme();
  const operations = useControlCenterStore(s => s.operations);
  const devices = useControlCenterStore(s => s.devices);
  const connected = useControlCenterStore(s => s.wsConnected);
  const unavailable = useControlCenterStore(s => s.operationsUnavailable);
  const refresh = useControlCenterStore(s => s.refreshOperations);
  const [activeOnly, setActiveOnly] = useState(false);
  const [source, setSource] = useState(initialSource);
  const [deviceId, setDeviceId] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (open) void refresh();
    else setSelectedId(undefined);
  }, [open, refresh]);
  useEffect(() => {
    setSelectedId(undefined);
    setSource(initialSource);
    setDeviceId(undefined);
  }, [sessionId, initialSource]);

  const operationsInScope = sessionId ? operations.filter(row => row.session_id === sessionId) : operations;
  const visible = operationsInScope.filter(row => (!activeOnly || isActiveOperation(row)) &&
    (!source || row.source_kind === source) && (!deviceId || row.source_device_id === deviceId));
  const sourceChoices = [...new Set(operationsInScope.map(row => row.source_kind))];
  const deviceChoices = [...new Set(operationsInScope.map(row => row.source_device_id)
    .filter((id): id is string => Boolean(id)))];
  const selected = operationsInScope.find(row => row.operation_id === selectedId);
  const showLiveElapsed = (selected ? [selected] : visible).some(row =>
    (row.phase === 'running' || row.phase === 'waiting') &&
    typeof row.started_at === 'string' && Number.isFinite(Date.parse(row.started_at)));
  useEffect(() => {
    if (!open || !showLiveElapsed) return;

    let timer: ReturnType<typeof setInterval> | undefined;
    const updateClock = (active: boolean) => {
      clearInterval(timer);
      if (!active) return;
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), 1000);
    };
    const subscription = AppState.addEventListener('change', state => updateClock(state === 'active'));
    updateClock(AppState.currentState == null || AppState.currentState === 'active');
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [open, showLiveElapsed]);
  const deviceName = (id?: string) => devices.find(device => device.id === id)?.name ??
    operations.find(row => row.source_device_id === id)?.source_device_name ?? id;
  const sourceLabel = (kind: string) => t(`activity.type.${kind}`, { defaultValue: kind });
  const formatValue = (value: number, unit?: string) => unit === 'bytes' ? formatBytes(value) : value.toLocaleString();
  const isDeviceOffline = (row: Operation) => {
    const status = devices.find(device => device.id === row.source_device_id)?.status;
    return status ? status === 'offline' : row.source_device_online === false;
  };
  const rowDetails = (row: Operation) => [
    t(`activity.phase.${row.phase}`),
    sourceLabel(row.source_kind),
    deviceName(row.source_device_id),
    isActiveOperation(row) && isDeviceOffline(row) ? t('activity.deviceOffline') : undefined,
    row.step ?? (row.stage && t(`activity.stage.${row.stage}`, { defaultValue: '' })),
  ].filter(Boolean).join(' · ');

  const renderElapsed = (row: Operation) => {
    const elapsed = operationElapsedLabel(row, now);
    if (elapsed === undefined) return null;
    return (
      <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
        {t('activity.elapsed', { value: elapsed })}
      </Text>
    );
  };

  const renderProgress = (row: Operation) => {
    const percent = operationPercent(row);
    if (percent === undefined) return null;
    return (
      <View style={styles.progressRow}>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: percent }}
          style={[styles.track, { backgroundColor: theme.colors.surfaceContainerHighest }]}>
          <View style={[styles.fill, { width: `${percent}%`, backgroundColor: theme.colors.primary }]} />
        </View>
        <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>{percent}%</Text>
      </View>
    );
  };

  const renderCount = (row: Operation) => {
    const progress = row.progress;
    if (!progress || operationPercent(row) !== undefined) return null;
    const count = formatValue(progress.current, progress.unit);
    const label = progress.unit && progress.unit !== 'bytes'
      ? `${count} ${t(`activity.unit.${progress.unit}`, { defaultValue: progress.unit })}`
      : count;
    return (
      <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
    );
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={t('activity.title')}>
      <View style={styles.body}>
        {(!connected || unavailable) && (
          <Text style={{ color: theme.colors.onSurfaceVariant }}>{t('activity.stale')}</Text>
        )}
        {selected ? (
          <ScrollView contentContainerStyle={styles.detail}>
            <Pressable accessibilityRole="button" onPress={() => setSelectedId(undefined)} style={styles.button}>
              <Text style={{ color: theme.colors.primary }}>{t('activity.back')}</Text>
            </Pressable>
            <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>{selected.title}</Text>
            <Text style={{ color: theme.colors.onSurfaceVariant }}>{rowDetails(selected)}</Text>
            {renderElapsed(selected)}
            {renderProgress(selected)}
            {selected.progress && (
              <Text style={{ color: theme.colors.onSurfaceVariant }}>
                {formatValue(selected.progress.current, selected.progress.unit)}
                {selected.progress.total ? ` / ${formatValue(selected.progress.total, selected.progress.unit)}` : ''}
                {selected.rate ? ` · ${t('activity.rate', { value: formatValue(Math.round(selected.rate), selected.progress.unit) })}` : ''}
                {selected.eta_seconds !== undefined ? ` · ${t('activity.eta', { value: Math.ceil(selected.eta_seconds / 60) })}` : ''}
              </Text>
            )}
            {selected.message ? <Text style={{ color: theme.colors.onSurface }}>{selected.message}</Text> : null}
            {selected.error_code ? <Text style={{ color: theme.colors.error }}>{selected.error_code}</Text> : null}
            {selected.kind === 'shell' && selected.source_kind === 'ai_progress' && isActiveOperation(selected) && (
              <Text style={{ color: theme.colors.onSurfaceVariant }}>{t('activity.shellStopScope')}</Text>
            )}
            <Text style={{ color: theme.colors.onSurfaceVariant }}>
              {t('activity.updated', { value: new Date(selected.updated_at).toLocaleString() })}
            </Text>
            {selected.transitions && selected.transitions.length > 1 && (
              <View>
                <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>{t('activity.timeline')}</Text>
                {selected.transitions.map(entry => (
                  <Text key={`${entry.at}-${entry.phase}-${entry.stage}`} style={{ color: theme.colors.onSurfaceVariant }}>
                    {entry.stage
                      ? t(`activity.stage.${entry.stage}`, { defaultValue: t(`activity.phase.${entry.phase}`) })
                      : t(`activity.phase.${entry.phase}`)}
                    {' · '}{new Date(entry.at).toLocaleTimeString()}
                  </Text>
                ))}
              </View>
            )}
            {selected.session_id && (
              <Pressable accessibilityRole="button" style={styles.button} onPress={() => {
                if (selected.session_id) onOpenSession(selected.session_id);
              }}>
                <Text style={{ color: theme.colors.primary }}>{t('activity.openSession')}</Text>
              </Pressable>
            )}
          </ScrollView>
        ) : (
          <>
            <View style={styles.filters}>
              {[false, true].map(active => (
                <Pressable key={String(active)} accessibilityRole="button"
                  accessibilityState={{ selected: activeOnly === active }} onPress={() => setActiveOnly(active)} style={styles.button}>
                  <Text style={{ color: activeOnly === active ? theme.colors.primary : theme.colors.onSurfaceVariant }}>
                    {t(active ? 'activity.active' : 'activity.all')}
                  </Text>
                </Pressable>
              ))}
            </View>
            {sourceChoices.length > 1 && <View style={styles.filters}>
              {sourceChoices.map(kind => (
                <Pressable key={kind} accessibilityRole="button" accessibilityState={{ selected: source === kind }}
                  style={styles.button} onPress={() => setSource(source === kind ? undefined : kind)}>
                  <Text style={{ color: source === kind ? theme.colors.primary : theme.colors.onSurfaceVariant }}>{sourceLabel(kind)}</Text>
                </Pressable>
              ))}
            </View>}
            {deviceChoices.length > 1 && <View style={styles.filters}>
              {deviceChoices.map(id => (
                <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: deviceId === id }}
                  style={styles.button} onPress={() => setDeviceId(deviceId === id ? undefined : id)}>
                  <Text style={{ color: deviceId === id ? theme.colors.primary : theme.colors.onSurfaceVariant }}>{deviceName(id)}</Text>
                </Pressable>
              ))}
            </View>}
            {onOpenSubagents && (
              <Pressable onPress={onOpenSubagents} accessibilityRole="button" style={styles.button}>
                <Text style={{ color: theme.colors.primary }}>{t('activity.subagentDetails')}</Text>
              </Pressable>
            )}
            <FlatList
              data={visible}
              keyExtractor={row => row.operation_id}
              ListEmptyComponent={<Text style={{ color: theme.colors.onSurfaceVariant }}>{t('activity.empty')}</Text>}
              renderItem={({ item }) => (
                <Pressable accessibilityRole="button" onPress={() => setSelectedId(item.operation_id)}
                  style={[styles.row, { borderBottomColor: theme.colors.outlineVariant }]}>
                  <Text numberOfLines={2} style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>{item.title}</Text>
                  <Text numberOfLines={2} style={{ color: theme.colors.onSurfaceVariant }}>{rowDetails(item)}</Text>
                  {renderElapsed(item)}
                  {renderProgress(item)}
                  {renderCount(item)}
                </Pressable>
              )}
            />
          </>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: 16 },
  detail: { gap: 10 },
  filters: { flexWrap: 'wrap', flexDirection: 'row', gap: 12 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  row: { gap: 5, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%' },
});
