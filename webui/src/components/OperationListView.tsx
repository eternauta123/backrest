import React, { useEffect, useState } from "react";
import { Operation, OperationEventType } from "../../gen/ts/v1/operations_pb";
import { Empty, List } from "antd";
import _ from "lodash";
import {
  GetOperationsRequestSchema,
  type GetOperationsRequest,
} from "../../gen/ts/v1/service_pb";
import { useAlertApi } from "./Alerts";
import { OperationRow } from "./OperationRow";
import { OplogState, syncStateFromRequest } from "../state/logstate";
import { shouldHideStatus } from "../state/oplog";
import { toJsonString } from "@bufbuild/protobuf";
import { shouldHideOperation } from "../state/oplog";
import {
  FlowDisplayInfo,
  displayInfoForFlow,
} from "../state/flowdisplayaggregator";

// OperationList displays a list of operations that are either fetched based on 'req' or passed in via 'useBackups'.
// If showPlan is provided the planId will be displayed next to each operation in the operation list.
export const OperationListView = ({
  req,
  useOperations,
  showPlan,
  displayHooksInline,
  filter,
  showDelete,
  backups
}: React.PropsWithoutRef<{
  req?: GetOperationsRequest;
  useOperations?: Operation[]; // exact set of operations to display; no filtering will be applied.
  showPlan?: boolean;
  displayHooksInline?: boolean;
  filter?: (op: Operation) => boolean;
  showDelete?: boolean; // allows deleting individual operation rows, useful for the list view in the plan / repo panels.
  backups?:FlowDisplayInfo[];
}>) => {
  const alertApi = useAlertApi();
  let [operations, setOperations] = useState<Operation[]>([]);
  const backupInfoByFlowID = new Map<bigint, FlowDisplayInfo>();
  //const [backups, setBackups] = useState<FlowDisplayInfo[]>([]);  
  const [backupsList, setBackups] = useState<FlowDisplayInfo[]>(() => backups || []);

  if (!backups && req) {
    useEffect(() => {
      const logState = new OplogState(
        (op) => !shouldHideStatus(op.status) && (!filter || filter(op))
      );

      logState.subscribe((ids, flowIDs, event) => {
        setOperations(logState.getAll());
        //Get all backups to be used on DeltaSnapshots
        if (
          event === OperationEventType.EVENT_CREATED ||
          event === OperationEventType.EVENT_UPDATED
        ) {
          for (const flowID of flowIDs) {
            const ops = logState.getByFlowID(flowID);
            //Ignore operations that are not backups or that did not create yet the snapshot
            if (!ops || ops[0].op.case !== "operationBackup" || ops[0].snapshotId === '') {
              continue;
            }
            const displayInfo = displayInfoForFlow(ops);
            if (!displayInfo.hidden) {
              backupInfoByFlowID.set(flowID, displayInfo);
            } else {
              backupInfoByFlowID.delete(flowID);
            }
          }
        } else if (event === OperationEventType.EVENT_DELETED) {
          for (const flowID of flowIDs) {
            backupInfoByFlowID.delete(flowID);
          }
        }
        setBackups([...backupInfoByFlowID.values()]);
      });

      return syncStateFromRequest(logState, req, (e) => {
        alertApi!.error("Failed to fetch operations: " + e.message);
      });
    }, [toJsonString(GetOperationsRequestSchema, req)]);
  }
  if (!operations) {
    return (
      <Empty
        description="No operations yet."
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      ></Empty>
    );
  }

  const hookExecutionsForOperation: Map<BigInt, Operation[]> = new Map();
  let operationsForDisplay: Operation[] = [];
  if (useOperations) {
    operations = [...useOperations];
  }
  if (!displayHooksInline) {
    operationsForDisplay = operations.filter((op) => {
      if (op.op.case === "operationRunHook") {
        const parentOp = op.op.value.parentOp;
        if (!hookExecutionsForOperation.has(parentOp)) {
          hookExecutionsForOperation.set(parentOp, []);
        }
        hookExecutionsForOperation.get(parentOp)!.push(op);
        return false;
      }
      return true;
    });
  } else {
    operationsForDisplay = operations;
  }
  operationsForDisplay.sort((a, b) => {
    return Number(b.unixTimeStartMs - a.unixTimeStartMs);
  });
  return (
    <List
      itemLayout="horizontal"
      size="small"
      dataSource={operationsForDisplay}
      renderItem={(op) => {
        return (
          <OperationRow
            alertApi={alertApi!}
            key={op.id}
            operation={op}
            showPlan={showPlan || false}
            hookOperations={hookExecutionsForOperation.get(op.id)}
            showDelete={showDelete}
            backups={backupsList?.filter((b) => b.flowID !== op.flowId && b.displayTime < op.unixTimeStartMs ).sort( (a,b)=> b.displayTime-a.displayTime)}
          />
        );
      }}
      pagination={
        operationsForDisplay.length > 25
          ? { position: "both", align: "center", defaultPageSize: 25 }
          : undefined
      }
    />
  );
};
