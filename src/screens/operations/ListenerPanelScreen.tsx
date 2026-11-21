import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { StatusChip } from '../../components/shared/StatusChip';
import { RootStackParamList } from '../../app/navigation/types';
import { useTheme } from '../../theme/useTheme';
import { useToastStore } from '../../store/toastStore';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { IconBadge, IconGlyph } from '../../components/visual/IconBadge';
import { useTranslation } from 'react-i18next';
import { ApiResponseError } from '../../api/client';
import {
  deleteListener,
  fetchListenerEvents,
  fetchListeners,
  ListenerEvent,
  ListenerItem,
  ListenerStatus,
  patchListener,
} from '../../api/listeners';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

const POLL_INTERVAL_MS = 5_000;

const statusLabelKey: Record<ListenerStatus, string> = {
  active: 'listener.statusActive',
  paused: 'listener.statusPaused',
  fired: 'listener.statusFired',
  expired: 'listener.statusExpired',
  error: 'listener.statusError',
};

/** 服务端有响应(ApiResponseError)= 业务错误→toast;其余(网络/超时)=离线。 */
const isOfflineError = (error: unknown): boolean =>
  !(error instanceof ApiResponseError);

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const ListenerPanelScreen: React.FC = () => {
  const { theme } = useTheme();
  const { t } = useTranslation('operations');
  const navigation = useNavigation<Navigation>();
  const showToast = useToastStore(state => state.show);
  const serverMode = useControlCenterStore(state => state.serverMode);
  const resetListenerUnread = useControlCenterStore(
    state => state.resetListenerUnread,
  );

  const [listeners, setListeners] = useState<ListenerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [mutating, setMutating] = useState<{
    id: string;
    kind: 'resume' | 'delete';
  } | null>(null);
  // 展开行的触发事件缓存(按 id),展开时懒加载,跨轮询保留。
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [eventsById, setEventsById] = useState<Record<string, ListenerEvent[]>>({});
  const [eventsLoadingId, setEventsLoadingId] = useState<string | null>(null);
  // 事件拉取失败的行 id:失败不写缓存(下次展开自动重试),行内提示可重试。
  const [eventsErrorId, setEventsErrorId] = useState<string | null>(null);
  const loadInFlight = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    // silent(轮询):不点亮 RefreshControl 转圈,避免每 5s 闪一次。
    if (!silent) setLoading(true);
    try {
      const items = await fetchListeners();
      setListeners(items);
      setOffline(false);
      setLoadedOnce(true);
    } catch (error) {
      if (isOfflineError(error)) {
        setOffline(true);
      } else {
        // 服务端明确拒绝(4xx/5xx):toast 呈现,不打成「离线」。
        showToast(errorText(error), 'error');
      }
      setLoadedOnce(true);
    } finally {
      loadInFlight.current = false;
      if (!silent) setLoading(false);
    }
  }, [showToast]);

  // 聚焦即拉取 + 清角标;聚焦期间 5s 静默轮询,离屏即停。
  useFocusEffect(
    useCallback(() => {
      resetListenerUnread();
      if (serverMode) {
        void load();
      }
      const timer = setInterval(() => {
        if (serverMode) {
          void load(true);
        }
      }, POLL_INTERVAL_MS);
      return () => clearInterval(timer);
    }, [load, resetListenerUnread, serverMode]),
  );

  const handleResume = useCallback(
    (item: ListenerItem) => {
      if (mutating) return;
      setMutating({ id: item.id, kind: 'resume' });
      // 复活契约:{status:'active', updated_at: 行的 updated_at}(乐观锁)。
      patchListener(item.id, {
        status: 'active',
        updated_at: item.updated_at,
      })
        .then(() => load())
        .catch(error => {
          showToast(t('listener.actionFailed', { reason: errorText(error) }), 'error');
        })
        .finally(() => setMutating(null));
    },
    [load, mutating, showToast, t],
  );

  const handleDelete = useCallback(
    (item: ListenerItem) => {
      if (mutating) return;
      Alert.alert(
        t('listener.confirmDeleteTitle'),
        t('listener.confirmDeleteMessage', { title: item.title }),
        [
          { text: t('listener.confirmDeleteCancel'), style: 'cancel' },
          {
            text: t('listener.confirmDeleteOk'),
            style: 'destructive',
            onPress: () => {
              setMutating({ id: item.id, kind: 'delete' });
              deleteListener(item.id)
                .then(() => {
                  if (expandedId === item.id) {
                    setExpandedId(null);
                  }
                  return load();
                })
                .catch(error => {
                  showToast(
                    t('listener.actionFailed', { reason: errorText(error) }),
                    'error',
                  );
                })
                .finally(() => setMutating(null));
            },
          },
        ],
      );
    },
    [expandedId, load, mutating, showToast, t],
  );

  const handleToggleExpand = useCallback(
    (item: ListenerItem) => {
      const nextExpanded = expandedId === item.id ? null : item.id;
      setExpandedId(nextExpanded);
      if (
        nextExpanded !== null &&
        !Object.prototype.hasOwnProperty.call(eventsById, nextExpanded)
      ) {
        setEventsLoadingId(nextExpanded);
        fetchListenerEvents(nextExpanded)
          .then(events => {
            setEventsById(prev => ({ ...prev, [nextExpanded]: events }));
            setEventsErrorId(prev => (prev === nextExpanded ? null : prev));
          })
          .catch(error => {
            showToast(
              t('listener.actionFailed', { reason: errorText(error) }),
              'error',
            );
            // 失败不落缓存:占位 [] 会让该行永远显示「暂无记录」且不再重试。
            // 不写 → 下次展开(收起再展开)自然重拉。
            setEventsErrorId(nextExpanded);
          })
          .finally(() => setEventsLoadingId(null));
      }
    },
    [eventsById, expandedId, showToast, t],
  );

  const errorCount = listeners.filter(item => item.status === 'error').length;

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={t('listener.title')}
        subtitle={t('listener.subtitle')}
        onBack={navigation.goBack}
        rightAction={
          <StatusChip
            label={`${listeners.length}`}
            type={errorCount ? 'warning' : 'neutral'}
          />
        }
      />
      <FlatList
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        data={listeners}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <ListenerCard
            item={item}
            expanded={expandedId === item.id}
            events={expandedId === item.id ? eventsById[item.id] : undefined}
            eventsLoading={eventsLoadingId === item.id}
            eventsError={eventsErrorId === item.id}
            mutating={mutating}
            onToggleExpand={handleToggleExpand}
            onResume={handleResume}
            onDelete={handleDelete}
          />
        )}
        removeClippedSubviews
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void load()}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
        ListHeaderComponent={
          offline ? (
            <GlassPanel style={styles.offlinePanel}>
              <IconBadge name="warning" tone="warning" size={42} iconSize={21} />
              <View style={styles.offlineCopy}>
                <Text
                  style={[
                    theme.typography.bodySm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
                  {t('listener.offlineRetry')}
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  testID="listener-retry"
                  onPress={() => void load()}
                  style={[
                    styles.retryButton,
                    {
                      borderColor: theme.colors.outlineVariant,
                      borderRadius: theme.borderRadius.full,
                    },
                  ]}>
                  <Text
                    style={[
                      theme.typography.codeSm,
                      { color: theme.colors.primary },
                    ]}>
                    {t('listener.retry')}
                  </Text>
                </TouchableOpacity>
              </View>
            </GlassPanel>
          ) : null
        }
        ListEmptyComponent={
          !offline && (loadedOnce || !serverMode) ? (
            <GlassPanel style={styles.emptyPanel}>
              <IconBadge name="bell" tone="neutral" size={42} iconSize={21} />
              <View style={styles.emptyCopy}>
                <Text
                  style={[
                    theme.typography.titleMd,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
                  {t('listener.emptyTitle')}
                </Text>
                <Text
                  style={[
                    theme.typography.bodySm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
                  {t('listener.emptyBody')}
                </Text>
              </View>
            </GlassPanel>
          ) : null
        }
      />
    </SafeAreaWrapper>
  );
};

const statusDotColor = (
  status: ListenerStatus,
  colors: ReturnType<typeof useTheme>['theme']['colors'],
): string => {
  switch (status) {
    case 'active':
      return colors.success;
    case 'paused':
      return colors.onSurfaceVariant;
    // fired=已触发(单次到达/待过期)→ warning;expired=哑火 → tertiary。
    // 与网页面板同口径(2026-11-22 评审对齐)。
    case 'fired':
      return colors.warning;
    case 'expired':
      return colors.tertiary;
    case 'error':
      return colors.error;
  }
};

interface ListenerCardProps {
  item: ListenerItem;
  expanded: boolean;
  events?: ListenerEvent[];
  eventsLoading: boolean;
  eventsError: boolean;
  mutating: { id: string; kind: 'resume' | 'delete' } | null;
  onToggleExpand: (item: ListenerItem) => void;
  onResume: (item: ListenerItem) => void;
  onDelete: (item: ListenerItem) => void;
}

const ListenerCard: React.FC<ListenerCardProps> = React.memo(
  ({ item, expanded, events, eventsLoading, eventsError, mutating, onToggleExpand, onResume, onDelete }) => {
    const { theme } = useTheme();
    const { t } = useTranslation('operations');
    const busy = mutating?.id === item.id;
    const lastFiredLabel = formatRelativeTime(item.last_fired_at, t);
    return (
      <View testID={`listener-row-${item.id}`}>
      <GlassPanel
        glowColor={item.status === 'error' ? 'error' : 'none'}
        style={styles.listenerCard}>
        <View style={styles.cardHeader}>
          <View style={styles.statusBlock}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: statusDotColor(item.status, theme.colors) },
              ]}
            />
            <Text
              style={[
                theme.typography.labelSm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              {t(statusLabelKey[item.status])}
            </Text>
          </View>
          <View style={styles.modeChipWrap}>
            <View
              style={[
                styles.modeChip,
                {
                  borderColor: theme.colors.outlineVariant,
                  borderRadius: theme.borderRadius.full,
                },
              ]}>
              <Text
                style={[
                  theme.typography.labelSm,
                  { color: theme.colors.onSurfaceVariant },
                ]}>
                {t(item.mode === 'once' ? 'listener.modeOnce' : 'listener.modeRecurring')}
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('listener.title')}
              testID={`listener-expand-${item.id}`}
              activeOpacity={0.75}
              onPress={() => onToggleExpand(item)}
              style={styles.chevronButton}>
              <View
                style={{
                  transform: [{ rotate: expanded ? '180deg' : '0deg' }],
                }}>
                <IconGlyph
                  name="chevron"
                  size={18}
                  color={theme.colors.onSurfaceVariant}
                />
              </View>
            </TouchableOpacity>
          </View>
        </View>
        <Text
          numberOfLines={2}
          style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
          {item.title}
        </Text>
        <View style={styles.metaRow}>
          <Text
            numberOfLines={1}
            style={[
              theme.typography.bodySm,
              { color: theme.colors.onSurfaceVariant },
            ]}>
            {t('listener.lastFired', { time: lastFiredLabel })}
          </Text>
          <Text
            style={[
              theme.typography.bodySm,
              { color: theme.colors.onSurfaceVariant },
            ]}>
            {t('listener.fireCount', { count: item.fired_count })}
          </Text>
        </View>
        {item.status === 'error' && item.error_note ? (
          <View
            style={[
              styles.errorBox,
              {
                borderColor: theme.colors.error,
                borderRadius: theme.borderRadius.md,
              },
            ]}>
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.error }]}>
              {t('listener.errorNote', { note: item.error_note })}
            </Text>
          </View>
        ) : null}
        <View style={styles.actionRow}>
          {item.status === 'error' ? (
            <TouchableOpacity
              accessibilityRole="button"
              testID={`listener-resume-${item.id}`}
              activeOpacity={0.75}
              disabled={Boolean(mutating)}
              onPress={() => onResume(item)}
              style={[
                styles.actionButton,
                styles.resumeButton,
                {
                  borderColor: theme.colors.primary,
                  borderRadius: theme.borderRadius.full,
                  opacity: mutating && !busy ? 0.5 : 1,
                },
              ]}>
              <Text
                style={[
                  theme.typography.codeSm,
                  { color: theme.colors.primary },
                ]}>
                {t('listener.actionResume')}
              </Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            accessibilityRole="button"
            testID={`listener-delete-${item.id}`}
            activeOpacity={0.75}
            disabled={Boolean(mutating)}
            onPress={() => onDelete(item)}
            style={[
              styles.actionButton,
              styles.deleteButton,
              {
                borderColor: theme.colors.outlineVariant,
                borderRadius: theme.borderRadius.full,
                opacity: mutating && !busy ? 0.5 : 1,
              },
            ]}>
            <Text
              style={[
                theme.typography.codeSm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              {t('listener.actionDelete')}
            </Text>
          </TouchableOpacity>
        </View>
        {expanded ? (
          <View
            style={[
              styles.eventsBox,
              {
                borderColor: theme.colors.outlineVariant,
                borderRadius: theme.borderRadius.md,
                backgroundColor: theme.colors.surfaceContainerLow,
              },
            ]}>
            {eventsLoading ? (
              <Text
                style={[
                  theme.typography.codeSm,
                  { color: theme.colors.onSurfaceVariant },
                ]}>
                {t('listener.eventsLoading')}
              </Text>
            ) : eventsError ? (
              <Text
                style={[
                  theme.typography.codeSm,
                  { color: theme.colors.error },
                ]}>
                {t('listener.eventsFailed')}
              </Text>
            ) : events && events.length ? (
              events.map((eventItem, index) => (
                <View key={`${eventItem.fired_at}-${index}`} style={styles.eventRow}>
                  <Text
                    numberOfLines={1}
                    style={[
                      theme.typography.codeSm,
                      { color: theme.colors.primary },
                    ]}>
                    {formatRelativeTime(eventItem.fired_at, t)}
                  </Text>
                  <Text
                    style={[
                      theme.typography.bodySm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}>
                    {eventItem.summary}
                  </Text>
                </View>
              ))
            ) : (
              <Text
                style={[
                  theme.typography.codeSm,
                  { color: theme.colors.onSurfaceVariant },
                ]}>
                {t('listener.eventsEmpty')}
              </Text>
            )}
          </View>
        ) : null}
      </GlassPanel>
      </View>
    );
  },
);
ListenerCard.displayName = 'ListenerCard';

/** 相对时间标签:刚刚/N 分钟前/N 小时前/N 天前;缺省/非法 → 「尚未触发」。 */
function formatRelativeTime(
  iso: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!iso) return t('listener.neverFired');
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return t('listener.neverFired');
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return t('listener.timeJustNow');
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return t('listener.timeMinutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('listener.timeHours', { count: hours });
  return t('listener.timeDays', { count: Math.floor(hours / 24) });
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  offlinePanel: {
    padding: 14,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  offlineCopy: {
    flex: 1,
    gap: 8,
  },
  retryButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  emptyPanel: {
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    opacity: 0.68,
  },
  emptyCopy: {
    flex: 1,
    gap: 4,
  },
  listenerCard: {
    padding: 14,
    marginBottom: 12,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  statusBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  modeChipWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modeChip: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  chevronButton: {
    paddingLeft: 6,
    paddingVertical: 4,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 12,
    rowGap: 4,
  },
  errorBox: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    borderWidth: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  resumeButton: {
    flex: 1,
  },
  deleteButton: {
    flex: 1,
  },
  eventsBox: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 8,
  },
  eventRow: {
    gap: 2,
  },
});
