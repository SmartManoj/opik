import React, { useCallback, useMemo, useState } from "react";
import {
  ColumnPinningState,
  ColumnSort,
  Row,
  RowSelectionState,
} from "@tanstack/react-table";
import useLocalStorageState from "use-local-storage-state";
import { keepPreviousData } from "@tanstack/react-query";
import get from "lodash/get";
import isObject from "lodash/isObject";

import Loader from "@/components/shared/Loader/Loader";
import SearchInput from "@/components/shared/SearchInput/SearchInput";
import ColumnsButton from "@/components/shared/ColumnsButton/ColumnsButton";
import DatasetSelectBox from "@/components/pages-shared/experiments/DatasetSelectBox/DatasetSelectBox";
import ExperimentsPathsAutocomplete from "@/components/pages-shared/experiments/ExperimentsPathsAutocomplete/ExperimentsPathsAutocomplete";
import FiltersButton from "@/components/shared/FiltersButton/FiltersButton";
import ExperimentsActionsPanel from "@/components/pages-shared/experiments/ExperimentsActionsPanel/ExperimentsActionsPanel";
import DataTable from "@/components/shared/DataTable/DataTable";
import DataTableNoData from "@/components/shared/DataTableNoData/DataTableNoData";
import DataTablePagination from "@/components/shared/DataTablePagination/DataTablePagination";
import ResourceCell from "@/components/shared/DataTableCells/ResourceCell";
import FeedbackScoreHeader from "@/components/shared/DataTableHeaders/FeedbackScoreHeader";
import FeedbackScoreCell from "@/components/shared/DataTableCells/FeedbackScoreCell";
import CodeCell from "@/components/shared/DataTableCells/CodeCell";
import DurationCell from "@/components/shared/DataTableCells/DurationCell";
import useAppStore from "@/store/AppStore";
import useGroupedExperimentsList, {
  GroupedExperiment,
} from "@/hooks/useGroupedExperimentsList";
import {
  checkIsMoreRowId,
  generateGroupedNameColumDef,
  generateGroupedCellDef,
  getIsCustomRow,
  getRowId,
  getSharedShiftCheckboxClickHandler,
  GROUPING_CONFIG,
  renderCustomRow,
} from "@/components/pages-shared/experiments/table";
import { DEFAULT_GROUPS_PER_PAGE, GROUPING_COLUMN } from "@/constants/grouping";
import {
  COLUMN_DATASET_ID,
  COLUMN_FEEDBACK_SCORES_ID,
  COLUMN_METADATA_ID,
  COLUMN_NAME_ID,
  COLUMN_TYPE,
  ColumnData,
  DynamicColumn,
} from "@/types/shared";
import { Filter, Filters } from "@/types/filters";
import { formatDate } from "@/lib/date";
import { RESOURCE_TYPE } from "@/components/shared/ResourceLink/ResourceLink";
import { useExpandingConfig } from "@/components/pages-shared/experiments/useExpandingConfig";
import { convertColumnDataToColumn, isColumnSortable } from "@/lib/table";
import { Separator } from "@/components/ui/separator";
import useExperimentsFeedbackScoresNames from "@/api/datasets/useExperimentsFeedbackScoresNames";
import { useDynamicColumnsCache } from "@/hooks/useDynamicColumnsCache";
import MultiResourceCell from "@/components/shared/DataTableCells/MultiResourceCell";
import { EXPLAINER_ID, EXPLAINERS_MAP } from "@/constants/explainers";

const SELECTED_COLUMNS_KEY = "prompt-experiments-selected-columns";
const COLUMNS_WIDTH_KEY = "prompt-experiments-columns-width";
const COLUMNS_ORDER_KEY = "prompt-experiments-columns-order";
const COLUMNS_SORT_KEY = "prompt-experiments-columns-sort";
const COLUMNS_SCORES_ORDER_KEY = "prompt-experiments-scores-columns-order";
const DYNAMIC_COLUMNS_KEY = "prompt-experiments-dynamic-columns";

export const DEFAULT_COLUMNS: ColumnData<GroupedExperiment>[] = [
  {
    id: "prompt",
    label: "Prompt commit",
    type: COLUMN_TYPE.list,
    accessorFn: (row) => get(row, ["prompt_versions"], []),
    cell: MultiResourceCell as never,
    customMeta: {
      nameKey: "commit",
      idKey: "prompt_id",
      resource: RESOURCE_TYPE.prompt,
      getSearch: (data: GroupedExperiment) => ({
        activeVersionId: get(data, "id", null),
      }),
    },
    explainer: EXPLAINERS_MAP[EXPLAINER_ID.whats_a_prompt_commit],
  },
  {
    id: COLUMN_METADATA_ID,
    label: "Configuration",
    type: COLUMN_TYPE.dictionary,
    accessorFn: (row) =>
      isObject(row.metadata)
        ? JSON.stringify(row.metadata, null, 2)
        : row.metadata,
    cell: CodeCell as never,
  },
  {
    id: "created_at",
    label: "Created",
    type: COLUMN_TYPE.time,
    accessorFn: (row) => formatDate(row.created_at),
  },
  {
    id: "created_by",
    label: "Created by",
    type: COLUMN_TYPE.string,
  },
  {
    id: "duration.p50",
    label: "Duration (avg.)",
    type: COLUMN_TYPE.duration,
    accessorFn: (row) => row.duration?.p50,
    cell: DurationCell as never,
  },
  {
    id: "duration.p90",
    label: "Duration (p90)",
    type: COLUMN_TYPE.duration,
    accessorFn: (row) => row.duration?.p90,
    cell: DurationCell as never,
  },
  {
    id: "duration.p99",
    label: "Duration (p99)",
    type: COLUMN_TYPE.duration,
    accessorFn: (row) => row.duration?.p99,
    cell: DurationCell as never,
  },
];

export const FILTER_COLUMNS: ColumnData<GroupedExperiment>[] = [
  {
    id: COLUMN_DATASET_ID,
    label: "Dataset",
    type: COLUMN_TYPE.string,
    disposable: true,
  },
  {
    id: COLUMN_METADATA_ID,
    label: "Configuration",
    type: COLUMN_TYPE.dictionary,
  },
];

export const DEFAULT_COLUMN_PINNING: ColumnPinningState = {
  left: [COLUMN_NAME_ID, GROUPING_COLUMN],
  right: [],
};

export const DEFAULT_SELECTED_COLUMNS: string[] = ["prompt", "created_at"];

interface ExperimentsTabProps {
  promptId: string;
}

const ExperimentsTab: React.FC<ExperimentsTabProps> = ({ promptId }) => {
  const workspaceName = useAppStore((state) => state.activeWorkspaceName);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [filters = [], setFilters] = useState<Filters>([]);
  const [groupLimit, setGroupLimit] = useState<Record<string, number>>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const [sortedColumns, setSortedColumns] = useLocalStorageState<ColumnSort[]>(
    COLUMNS_SORT_KEY,
    {
      defaultValue: [],
    },
  );

  const datasetId = useMemo(
    () =>
      (filters.find((f: Filter) => f.field === COLUMN_DATASET_ID)
        ?.value as string) || "",
    [filters],
  );

  const preProcessedFilters = useMemo(() => {
    return filters.filter((f: Filter) => f.field !== COLUMN_DATASET_ID);
  }, [filters]);

  const filtersConfig = useMemo(
    () => ({
      rowsMap: {
        [COLUMN_DATASET_ID]: {
          keyComponent: DatasetSelectBox,
          keyComponentProps: {
            className: "w-full min-w-72",
          },
          defaultOperator: "=",
          operators: [{ label: "=", value: "=" }],
        },
        [COLUMN_METADATA_ID]: {
          keyComponent: ExperimentsPathsAutocomplete,
          keyComponentProps: {
            placeholder: "key",
            excludeRoot: true,
            datasetId,
            promptId,
            sorting: sortedColumns,
          },
        },
      },
    }),
    [datasetId, promptId, sortedColumns],
  );

  const { checkboxClickHandler } = useMemo(() => {
    return {
      checkboxClickHandler: getSharedShiftCheckboxClickHandler(),
    };
  }, []);

  const { data, isPending } = useGroupedExperimentsList({
    workspaceName,
    groupLimit,
    datasetId,
    promptId,
    filters: preProcessedFilters,
    sorting: sortedColumns,
    search,
    page,
    size: DEFAULT_GROUPS_PER_PAGE,
  });

  const { data: feedbackScoresData, isPending: isFeedbackScoresPending } =
    useExperimentsFeedbackScoresNames(
      {},
      {
        placeholderData: keepPreviousData,
        refetchInterval: 30000,
      },
    );

  const experiments = useMemo(() => data?.content ?? [], [data?.content]);

  const sortableBy: string[] = useMemo(
    () => data?.sortable_by ?? [],
    [data?.sortable_by],
  );

  const groupIds = useMemo(() => data?.groupIds ?? [], [data?.groupIds]);
  const total = data?.total ?? 0;
  const noData = !search && filters.length === 0;
  const noDataText = noData
    ? "There are no experiments used this prompt"
    : "No search results";

  const [selectedColumns, setSelectedColumns] = useLocalStorageState<string[]>(
    SELECTED_COLUMNS_KEY,
    {
      defaultValue: DEFAULT_SELECTED_COLUMNS,
    },
  );

  const [columnsOrder, setColumnsOrder] = useLocalStorageState<string[]>(
    COLUMNS_ORDER_KEY,
    {
      defaultValue: [],
    },
  );

  const [scoresColumnsOrder, setScoresColumnsOrder] = useLocalStorageState<
    string[]
  >(COLUMNS_SCORES_ORDER_KEY, {
    defaultValue: [],
  });

  const [columnsWidth, setColumnsWidth] = useLocalStorageState<
    Record<string, number>
  >(COLUMNS_WIDTH_KEY, {
    defaultValue: {},
  });

  const dynamicScoresColumns = useMemo(() => {
    return (feedbackScoresData?.scores ?? [])
      .sort((c1, c2) => c1.name.localeCompare(c2.name))
      .map<DynamicColumn>((c) => ({
        id: `${COLUMN_FEEDBACK_SCORES_ID}.${c.name}`,
        label: c.name,
        columnType: COLUMN_TYPE.number,
      }));
  }, [feedbackScoresData?.scores]);

  const dynamicColumnsIds = useMemo(
    () => dynamicScoresColumns.map((c) => c.id),
    [dynamicScoresColumns],
  );

  useDynamicColumnsCache({
    dynamicColumnsKey: DYNAMIC_COLUMNS_KEY,
    dynamicColumnsIds,
    setSelectedColumns,
  });

  const scoresColumnsData = useMemo(() => {
    return [
      ...dynamicScoresColumns.map(
        ({ label, id, columnType }) =>
          ({
            id,
            label,
            type: columnType,
            header: FeedbackScoreHeader as never,
            cell: FeedbackScoreCell as never,
            accessorFn: (row) =>
              row.feedback_scores?.find((f) => f.name === label),
          }) as ColumnData<GroupedExperiment>,
      ),
    ];
  }, [dynamicScoresColumns]);

  const selectedRows: Array<GroupedExperiment> = useMemo(() => {
    return experiments.filter(
      (row) => rowSelection[row.id] && !checkIsMoreRowId(row.id),
    );
  }, [rowSelection, experiments]);

  const columns = useMemo(() => {
    return [
      generateGroupedNameColumDef<GroupedExperiment>(
        checkboxClickHandler,
        isColumnSortable(COLUMN_NAME_ID, sortableBy),
      ),
      generateGroupedCellDef<GroupedExperiment, unknown>(
        {
          id: GROUPING_COLUMN,
          label: "Dataset",
          type: COLUMN_TYPE.string,
          cell: ResourceCell as never,
          customMeta: {
            nameKey: "dataset_name",
            idKey: "dataset_id",
            resource: RESOURCE_TYPE.dataset,
          },
        },
        checkboxClickHandler,
      ),
      ...convertColumnDataToColumn<GroupedExperiment, GroupedExperiment>(
        DEFAULT_COLUMNS,
        {
          columnsOrder,
          selectedColumns,
          sortableColumns: sortableBy,
        },
      ),
      ...convertColumnDataToColumn<GroupedExperiment, GroupedExperiment>(
        scoresColumnsData,
        {
          columnsOrder: scoresColumnsOrder,
          selectedColumns,
          sortableColumns: sortableBy,
        },
      ),
    ];
  }, [
    checkboxClickHandler,
    sortableBy,
    columnsOrder,
    selectedColumns,
    scoresColumnsData,
    scoresColumnsOrder,
  ]);

  const sortConfig = useMemo(
    () => ({
      enabled: true,
      sorting: sortedColumns,
      setSorting: setSortedColumns,
    }),
    [setSortedColumns, sortedColumns],
  );

  const resizeConfig = useMemo(
    () => ({
      enabled: true,
      columnSizing: columnsWidth,
      onColumnResize: setColumnsWidth,
    }),
    [columnsWidth, setColumnsWidth],
  );

  const expandingConfig = useExpandingConfig({
    groupIds,
  });

  const renderCustomRowCallback = useCallback(
    (row: Row<GroupedExperiment>, applyStickyWorkaround?: boolean) => {
      return renderCustomRow(row, setGroupLimit, applyStickyWorkaround);
    },
    [setGroupLimit],
  );

  const columnSections = useMemo(() => {
    return [
      {
        title: "Feedback scores",
        columns: scoresColumnsData,
        order: scoresColumnsOrder,
        onOrderChange: setScoresColumnsOrder,
      },
    ];
  }, [scoresColumnsData, scoresColumnsOrder, setScoresColumnsOrder]);

  if (isPending || isFeedbackScoresPending) {
    return <Loader />;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-8 gap-y-2">
        <div className="flex items-center gap-2">
          <SearchInput
            searchText={search}
            setSearchText={setSearch}
            placeholder="Search by name"
            className="w-[320px]"
            dimension="sm"
          ></SearchInput>
          <FiltersButton
            columns={FILTER_COLUMNS}
            config={filtersConfig as never}
            filters={filters}
            onChange={setFilters}
          />
        </div>
        <div className="flex items-center gap-2">
          <ExperimentsActionsPanel experiments={selectedRows} />
          <Separator orientation="vertical" className="mx-2 h-4" />
          <ColumnsButton
            columns={DEFAULT_COLUMNS}
            selectedColumns={selectedColumns}
            onSelectionChange={setSelectedColumns}
            order={columnsOrder}
            onOrderChange={setColumnsOrder}
            sections={columnSections}
          ></ColumnsButton>
        </div>
      </div>
      <DataTable
        columns={columns}
        data={experiments}
        renderCustomRow={renderCustomRowCallback}
        getIsCustomRow={getIsCustomRow}
        sortConfig={sortConfig}
        resizeConfig={resizeConfig}
        selectionConfig={{
          rowSelection,
          setRowSelection,
        }}
        expandingConfig={expandingConfig}
        groupingConfig={GROUPING_CONFIG}
        getRowId={getRowId}
        columnPinning={DEFAULT_COLUMN_PINNING}
        noData={<DataTableNoData title={noDataText}></DataTableNoData>}
      />
      <div className="py-4">
        <DataTablePagination
          page={page}
          pageChange={setPage}
          size={DEFAULT_GROUPS_PER_PAGE}
          total={total}
        ></DataTablePagination>
      </div>
    </div>
  );
};

export default ExperimentsTab;
