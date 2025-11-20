import React, { useState } from "react";
import { Empty, Form, Select, Spin, Tooltip, Tree } from "antd";
import type { DataNode } from "antd/es/tree";
import {
  DiffEntry,
  SnapshotDiffRequestSchema,
} from "../../gen/ts/v1/service_pb";
import { useShowModal } from "./ModalManager";
import { backrestService } from "../api";
import { create } from "@bufbuild/protobuf";
import { FlowDisplayInfo } from "../state/flowdisplayaggregator";
import {
  formatTime,
  formatDuration
} from "../lib/formatting";
const SnapshotDeltasBrowserContext = React.createContext<{
  snapshotId: string;
  planId?: string;
  repoId: string;
  showModal: (modal: React.ReactNode) => void; // slight performance hack.
} | null>(null);
//import VirtualList from "rc-virtual-list";

// replaceKeyInTree returns a value only if changes are made.
const replaceKeyInTree = (
  curNode: DataNode,
  setKey: string,
  setValue: DataNode
): DataNode | null => {
  if (curNode.key === setKey) {
    return setValue;
  }
  if (!curNode.children || setKey.indexOf(curNode.key as string) === -1) {
    return null;
  }
  for (const idx in curNode.children!) {
    const child = curNode.children![idx];
    const newChild = replaceKeyInTree(child, setKey, setValue);
    if (newChild) {
      const curNodeCopy = { ...curNode };
      curNodeCopy.children = [...curNode.children!];
      curNodeCopy.children[idx] = newChild;
      return curNodeCopy;
    }
  }
  return null;
};
const findInTree = (curNode: DataNode, key: string): DataNode | null => {
  if (curNode.key === key) {
    return curNode;
  }
  if (!curNode.children || key.indexOf(curNode.key as string) === -1) {
    return null;
  }
  for (const child of curNode.children) {
    const found = findInTree(child, key);
    if (found) {
      return found;
    }
  }
  return null;
};

type DiffTotals = {"modified": number, "added": number, "removed": number, "metadata": number, "fileType": number, "unknown":number};
export const SnapshotDeltasBrowser = ({
  repoId,
  planId, // optional: purely to link restore operations to the right plan.
  snapshotId,
  backups,
}: React.PropsWithoutRef<{
  snapshotId: string;
  repoId: string;
  planId?: string;
  backups?: FlowDisplayInfo[] 
}>) => {
// * +  The item was added
// * -  The item was removed
// * U  The metadata (access mode, timestamps, ...) for the item was updated
// * M  The file's content was modified
// * T  The type was changed, e.g. a file was made a symlink
// * ?  Bitrot detected: The file's content has changed but all metadata is the same

  //const alertApi = useAlertApi();
  const showModal = useShowModal();
  const [loadingDiff, setLoadingDiff] =   useState(false);

  const splitPath = (path: string) => {
    return path.replace(/\\/g, "/").split("/").filter(Boolean);
  }
  const getNodeTotals = (entries: DiffEntry[], nodePath:string) => {
    const totals:DiffTotals = { "modified": 0, "added": 0, "removed": 0 , "metadata": 0, "fileType": 0, "unknown":0 };
    const parent = splitPath(nodePath);
    for (const { modifier, path } of entries) {
      const parts = splitPath(path);

      // Check if path belongs under this node (or is the node itself)
      let matches = true;
      for (let i = 0; i < parent.length; i++) {
        if (parts[i] !== parent[i]) {
          matches = false;
          break;
        }
      }

      if (matches) {
        switch (modifier)
        { case("M"):  totals.modified = totals.modified + 1; break;
          case("-"):  totals.removed  = totals.removed  + 1; break;
          case("+"):  totals.added    = totals.added + 1; break;
          case("U"):  totals.metadata = totals.metadata + 1; break;
          case("T"):  totals.fileType = totals.fileType + 1; break;
          case("?"):  totals.unknown  = totals.unknown + 1; break;
        }
      }
    }
    return totals;
  }

  const formatTotals = (totals: any) => {
    const parts = [];
    if (totals["modified"]) parts.push(`${totals["modified"]}M`);
    if (totals["added"]) parts.push(`${totals["added"]}+`);
    if (totals["removed"]) parts.push(`${totals["removed"]}-`);
    if (totals["metadata"]) parts.push(`${totals["metadata"]}MD`);
    if (totals["fileType"]) parts.push(`${totals["fileType"]}T`);
    if (totals["unknown"]) parts.push(`${totals["unknown"]}?`);
    return parts.length ? ` (${parts.join(" ")})` : "";
  }

  const [treeData, setTreeData] = useState<DataNode[]>();
  const [entries, setEntriesData] = useState<DiffEntry[]>([]);

  const diffColors = {
    "modified": "#d48806",   // modified - orange/yellow
    "metadata": "#d48807",   // modified - orange/yellow
    "fileType": "#d48808",   // modified - orange/yellow
    "unknown": "#d48809",   // modified - orange/yellow
    "added": "#389e0d",   // added - green
    "removed": "#cf1322"    // deleted - red
  };

 const colored = (text: string, type: "modified" | "added" | "removed" | "unknown" | "metadata" | "fileType") =>{
    return (
      <span style={{ color: diffColors[type], fontWeight: 700 }}>{text}</span>
    );
}
const formatTotalsColor = (totals: any) => {
  const parts: any[] = [];
  const partsTooltip: any[] = [];
  if (totals["modified"])
  {
    parts.push(colored(`${totals["modified"]}M`, "modified"));
    partsTooltip.push(`${totals["modified"]} Modified`);
  }
  if (totals["added"])
  {
    parts.push(colored(`${totals["added"]}+`, "added"));
    partsTooltip.push(`${totals["added"]} Added`);
  }
  if (totals["removed"])
  {
    parts.push(colored(`${totals["removed"]}-`, "removed"));
    partsTooltip.push(`${totals["removed"]} Removed`);
  }
  if (totals["metadata"])
  {
    parts.push(colored(`${totals["metadata"]}MD`, "metadata"));
    partsTooltip.push(`${totals["metadata"]} Metadata change(s)`);
  }
  if (totals["fileType"])
  {
    parts.push(colored(`${totals["fileType"]}T`, "fileType"));
    partsTooltip.push(`${totals["fileType"]} File type change(s)`);
  }
  if (totals["unknown"])
  {
    parts.push(colored(`${totals["unknown"]}?`, "unknown"));
    partsTooltip.push(`${totals["modified"]} Unknown change(s)`);
  }

  if (!parts.length) return null;
  return <Tooltip title={partsTooltip.reduce((acc, curr, i) => [...acc, i ? " " : null, curr], [])}>
            <span className="backrest file-details"> ({parts.reduce((acc, curr, i) => [...acc, i ? " " : null, curr], [])})</span>
        </Tooltip>
}

const sortNodes = (nodes: DataNode[]): DataNode[] => {
  return nodes.sort((a, b) => {
    // folder first
    if (!a.isLeaf && b.isLeaf) return -1;
    if (a.isLeaf && !b.isLeaf) return 1;

    // alphabetical
    return (a.title || '') > (b.title || '' )? 1 : -1;
  });
}

const getChildren = (entries: DiffEntry[], nodePath: string): DataNode[] =>{
  const parent = splitPath(nodePath);
  const children: Record<string, DataNode & { __totals?: any, name:string, modifier?: string }> = {};
  for (const e of entries) {
    const parts = splitPath(e.path);

    // Only entries under this node
    let matches = true;
    for (let i = 0; i < parent.length; i++) {
      if (parts[i] !== parent[i]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;

    // Immediate child name
    if (parts.length > parent.length) {
      const name = parts[parent.length];
      const isDirectory = e.path.endsWith('/')
      const fullPath = "/" + [...parent, name].join("/")+ (isDirectory ? "/" : "");
      const changesOnThisPath = entries.filter((a:DiffEntry)=> a.path.substring(0,fullPath.length) == fullPath).length;
      const changed = entries.filter((a:DiffEntry)=> a.path == fullPath)?.length == 1 ;

      if (!children[name]) {
        children[name] = {
          key: fullPath,
          name: name,
          children: undefined,
          isLeaf: changesOnThisPath == 1 && !isDirectory,
          modifier: changed ? e.modifier : "",
          __totals: { "modified": 0, "added": 0, "removed": 0 , "metadata": 0, "fileType": 0, "unknown":0 }
        };
      }

      switch (e.modifier)
        { case("M"):  children[name].__totals.modified  = children[name].__totals.modified  + 1; break;
          case("-"):  children[name].__totals.removed   = children[name].__totals.removed   + 1; break;
          case("+"):  children[name].__totals.added     = children[name].__totals.added     + 1; break;
          case("U"):  children[name].__totals.metadata  = children[name].__totals.metadata  + 1; break;
          case("T"):  children[name].__totals.fileType  = children[name].__totals.fileType  + 1; break;
          case("?"):  children[name].__totals.unknown   = children[name].__totals.unknown   + 1; break;
        }
    }
  }

  const nodes = Object.values(children).map(node => {
    //const { modified, added, removed,metadata,fileType,unknown } = node.__totals!;

    // Leaf → rename with single modifier
    // const total =   Object.values(node.__totals).reduce(
    //   (sum: number, val) => sum + (Number(val) || 0),
    //     0
    //   );

    let suffix = null;
    switch (node.modifier)
      { case("M"):  suffix  = colored("(modified)", "modified");break;
        case("-"):  suffix  = colored("(removed)", "removed"); break;
        case("+"):  suffix  = colored("(added)", "added"); break;
        case("U"):  suffix  = colored("(metadata changed)", "metadata"); break;
        case("T"):  suffix  = colored("(file type changed)", "fileType"); break;
        case("?"):  suffix  = colored("(unknown change)", "unknown"); break;
      }
    if (node.isLeaf) {
      return {
        ...node,
        title: ( 
          <span>{node.name}
            <span className="backrest file-details"> {suffix}</span>
          </span>
        )
      };
    }
    else {
      // Folder → totals + color
      const totals = formatTotalsColor(node.__totals);
      delete node.__totals;
      return {
        ...node,
        title: (
            <span>{node.name} <span className="backrest file-details">{suffix}</span> {totals}</span>
        )
      };
    }
  });

  return sortNodes(nodes);
}

  const getSnapShotsDiff = async (prevSnapshotId:string) => {
    try {
      setLoadingDiff(true);
      setEntriesData([]);
      const resp = await backrestService.getSnapshotsDiff(
      create(SnapshotDiffRequestSchema, {
        repoId: repoId,
        planId: planId,
        snapshotId:snapshotId,
        prevSnapshotId: prevSnapshotId
        })
      );
      setEntriesData(resp.entries);
      const sufix = formatTotalsColor(getNodeTotals(resp.entries, "/"))

      const firstNode =   {
        key: "/",
        title: (
          <span>/ {sufix}</span>
        )
      }
      setTreeData([firstNode])
    } 
  finally
  {
    setLoadingDiff(false);
  }
  }
  
  const onLoadData = async (treeNode: any) => {
    const { key } = treeNode;

    const children = getChildren(entries, key);

    // Insert children into the tree
    const updateNode = (nodes: DataNode[]): DataNode[] =>
      nodes.map(n => {
        if (n.key === key) {
          return { ...n, children };
        }
        if (n.children) {
          return { ...n, children: updateNode(n.children) };
        }
        return n;
      });
      //Just for Linter... TreeData is guaranteed to exist at this point
        if (treeData) {
          setTreeData(updateNode(treeData));
      }
  };
  if (!backups || backups?.length == 0)
  {      
    return (<Empty description={"No previous backups to compare with"} image={Empty.PRESENTED_IMAGE_SIMPLE}></Empty>)
  }
  return (
    <SnapshotDeltasBrowserContext.Provider
      value={{ snapshotId, repoId, planId, showModal }}
    >
      <Tooltip
        title={
          <>
            Select one of the previous snapshots to be compared to.
          </>
        }
      >
        Select snapshot to compare with:
        <br />
        <Form.Item
          required={false}
        >
          <Select
            allowClear
            loading={loadingDiff}
            disabled={loadingDiff}
            style={{ width: "100%" }}
            placeholder="Select previous snapshot"
            options={backups?.sort( (a,b)=> b.displayTime-a.displayTime).map(
              (v) => ({
//                label: (<span><span>{formatTime(v.displayTime)}</span> <span className="backrest file-details">(ID: {v.snapshotID.slice(0,8)} {formatDuration((performance.now() -v.displayTime)/10000, {minUnit:'d',maxUnit:'d'})} ago)</span> </span>),
                label: (<span><span>{formatTime(v.displayTime)}</span> <span className="backrest file-details">(ID: {v.snapshotID.slice(0,8)})</span> </span>),
                value: v.snapshotID,
              })
              
            )}
            onChange={(value) => {
              getSnapShotsDiff(value)
            }}
          />
        </Form.Item>
      </Tooltip>
        {treeData && treeData?.length > 0 && !loadingDiff && (
          <Tree<DataNode> loadData={onLoadData} treeData={treeData} />
        )}
        {loadingDiff && (<Spin />)}
        
    </SnapshotDeltasBrowserContext.Provider>
  );

};
