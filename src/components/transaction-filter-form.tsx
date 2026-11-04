"use client";

import { useState, type FormEvent } from "react";

export type TransactionPersonOption = { id: string; name: string };

export function TransactionFilterForm({
  people,
  range,
  from,
  to,
  personId,
  timezone,
  groupId,
}: {
  people: TransactionPersonOption[];
  range: string;
  from: string;
  to: string;
  personId: string;
  timezone: string;
  groupId: string;
}) {
  const [selectedRange, setSelectedRange] = useState(range);
  function setBrowserTimezone(event: FormEvent<HTMLFormElement>) {
    const timezoneInput = event.currentTarget.elements.namedItem("tz");
    if (timezoneInput instanceof HTMLInputElement) {
      timezoneInput.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    }
  }

  return (
    <form action="/transactions" className="transaction-filter-form" method="get" onSubmit={setBrowserTimezone}>
      <label>
        Person
        <select defaultValue={personId} name="person">
          <option value="">Anyone</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>{person.name}</option>
          ))}
        </select>
      </label>
      <label>
        Date range
        <select
          onChange={(event) => setSelectedRange(event.target.value)}
          value={selectedRange}
          name="range"
        >
          <option value="all">All time</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="quarter">Last quarter</option>
          <option value="custom">Custom dates</option>
        </select>
      </label>
      <div className="transaction-custom-dates" hidden={selectedRange !== "custom"}>
        <label>
          From
          <input defaultValue={from} name="from" type="date" />
        </label>
        <label>
          Through
          <input defaultValue={to} name="to" type="date" />
        </label>
      </div>
      <input defaultValue={timezone} name="tz" type="hidden" />
      {groupId && <input name="group" type="hidden" value={groupId} />}
      <button className="button button-primary button-small" type="submit">Apply filters</button>
    </form>
  );
}
