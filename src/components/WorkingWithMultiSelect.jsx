import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";

// Stored values remain comma-separated stable IDs for backward compatibility.
// Changing teams/people is an Opportunity update, not a Handler handoff.
export const splitWorkingIds = (value) => String(value || "")
  .split(",").map((id) => id.trim()).filter(Boolean);

export function toggleWorkingId(value, id, max = 12) {
  const ids = splitWorkingIds(value);
  if (ids.includes(id)) return ids.filter((current) => current !== id).join(",");
  return ids.length < max ? [...ids, id].join(",") : ids.join(",");
}

export function selectableWorkingPeople(people, regionId, selectedIds = "") {
  const selected = new Set(splitWorkingIds(selectedIds));
  return (people || []).filter((person) => {
    if (selected.has(person.id)) return true; // Preserve legacy selections.
    return person.active && (person.region_ids || []).includes(regionId) &&
      person.app_role !== "management"; // Management is a Team, not a person option.
  });
}

const personName = (person) => person?.name || person?.id || "";
const teamName = (team) => team?.name || team?.id || "";

export default function WorkingWithMultiSelect({
  teams = [], people = [], regionId, teamIds = "", userIds = "",
  disabled = false, onTeams, onUsers,
}) {
  const [expanded, setExpanded] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [peopleQuery, setPeopleQuery] = useState("");
  const selectedTeamIds = splitWorkingIds(teamIds);
  const selectedUserIds = splitWorkingIds(userIds);
  const teamMap = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const peopleMap = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const teamOptions = useMemo(
    () => [...teams].filter((team) => team.active || selectedTeamIds.includes(team.id))
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999)),
    [teams, teamIds]
  );
  const peopleOptions = useMemo(
    () => selectableWorkingPeople(people, regionId, userIds)
      .sort((a, b) => personName(a).localeCompare(personName(b))),
    [people, regionId, userIds]
  );
  const visiblePeople = peopleOptions.filter((person) =>
    selectedUserIds.includes(person.id) || (
      peopleQuery.trim().length >= 2 &&
      `${person.name || ""} ${person.employee_id || ""}`.toLocaleLowerCase()
        .includes(peopleQuery.trim().toLocaleLowerCase())
    )
  );
  const selectedNames = [
    ...selectedTeamIds.map((id) => teamName(teamMap.get(id)) || id),
    ...selectedUserIds.map((id) => personName(peopleMap.get(id)) || id),
  ];
  const showManagementHint = !teamOptions.some((team) =>
    String(team.name || "").trim().toLocaleLowerCase() === "management");

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {selectedNames.length ? (
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5" aria-label="Selected collaborators">
            {selectedNames.map((name, index) => (
              <span key={index} className="inline-flex max-w-full items-center rounded-md bg-secondary px-2 py-1 text-xs text-foreground">
                <span className="truncate">{name}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="flex-1 text-xs text-muted-foreground">No team selected</span>
        )}
        {!disabled && (
          <button type="button" aria-expanded={expanded} aria-controls="working-with-editor"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {expanded ? "Done" : selectedNames.length ? "Edit" : "Select teams"}
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      {disabled && <p className="text-xs text-muted-foreground">Read-only. Changes are available on open Pipelines with edit access.</p>}
      {!disabled && expanded && (
        <div id="working-with-editor" className="space-y-3 rounded-xl border border-border bg-secondary/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold">Teams</p>
            <span className="text-[11px] text-muted-foreground">Optional · Up to 8</span>
          </div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {teamOptions.map((team) => {
              const checked = selectedTeamIds.includes(team.id);
              return (
                <label key={team.id} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-background/80 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                  <input type="checkbox" checked={checked}
                    disabled={!checked && selectedTeamIds.length >= 8}
                    onChange={() => onTeams(toggleWorkingId(teamIds, team.id, 8))}
                    className="h-4 w-4 shrink-0 accent-red-600" />
                  <span className="min-w-0 break-words">{team.name}</span>
                </label>
              );
            })}
            {!teamOptions.length && <p className="text-xs text-muted-foreground">No active teams in Pipeline Config</p>}
          </div>
          {showManagementHint && (
            <p className="text-xs text-amber-700">Management is missing from the loaded Working With list. Refresh the app or verify the Pipeline Config connection.</p>
          )}
          <div className="border-t border-border/70 pt-3">
            <button type="button" aria-expanded={showPeople}
              onClick={() => setShowPeople((value) => !value)}
              className="flex w-full items-center justify-between gap-2 rounded-md py-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Add a person (optional)
                {selectedUserIds.length > 0 && `· ${selectedUserIds.length} selected`}
              </span>
              {showPeople ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {showPeople && (
              <div className="mt-2 space-y-2">
                <div className="relative">
                  <Search aria-hidden="true" className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input value={peopleQuery} onChange={(event) => setPeopleQuery(event.target.value)}
                    aria-label="Search colleagues" placeholder="Search name or Employee ID"
                    className="h-9 pl-8 text-xs" />
                </div>
                <div className="max-h-40 space-y-0.5 overflow-y-auto" aria-label="Colleagues in Region">
                  {visiblePeople.map((person) => {
                    const checked = selectedUserIds.includes(person.id);
                    return (
                      <label key={person.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs hover:bg-background/80">
                        <input type="checkbox" checked={checked}
                          disabled={!checked && selectedUserIds.length >= 12}
                          onChange={() => onUsers(toggleWorkingId(userIds, person.id, 12))}
                          className="h-4 w-4 shrink-0 accent-red-600" />
                        <span className="min-w-0 break-words">{person.name} · {person.app_role?.toUpperCase()}</span>
                      </label>
                    );
                  })}
                  {!peopleQuery.trim() && !selectedUserIds.length && (
                    <p className="px-2 py-2 text-xs text-muted-foreground">Type at least 2 characters to find someone.</p>
                  )}
                  {peopleQuery.trim().length >= 2 && visiblePeople.length === 0 && (
                    <p className="px-2 py-2 text-xs text-muted-foreground">No matching colleagues in this Region.</p>
                  )}
                </div>
              </div>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Choose collaborators, then click Save Changes. This does not reassign Current Handler.</p>
        </div>
      )}
    </div>
  );
}
