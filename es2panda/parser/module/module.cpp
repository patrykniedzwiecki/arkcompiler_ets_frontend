/**
 * Copyright (c) 2021 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#include "module.h"

namespace panda::es2panda::parser {

    int SourceTextModuleRecord::AddModuleRequest(const util::StringView source)
    {
        ASSERT(!source.Empty());
        int moduleRequestsSize = static_cast<int>(moduleRequestsMap_.size());
        if (moduleRequestsMap_.find(source) == moduleRequestsMap_.end()) {
            moduleRequests_.emplace_back(source);
        }
        auto insertedRes = moduleRequestsMap_.insert(std::make_pair(source, moduleRequestsSize));
        return insertedRes.first->second;
    }

    // import x from 'test.js';
    // import {x} from 'test.js';
    // import {x as y} from 'test.js';
    // import defaultExport from 'test.js'
    void SourceTextModuleRecord::AddImportEntry(SourceTextModuleRecord::ImportEntry *entry)
    {
        ASSERT(!entry->importName_.Empty());
        ASSERT(!entry->localName_.Empty());
        ASSERT(entry->moduleRequestIdx_ != -1);
        regularImportEntries_.insert(std::make_pair(entry->localName_, entry));
        // the implicit indirect exports should be insert into indirectExportsEntries
        // when add an ImportEntry.
        // e.g. export { x }; import { x } from 'test.js'
        ConvertLocalExportsToIndirect(entry);
    }

    // import * as x from 'test.js';
    void SourceTextModuleRecord::AddStarImportEntry(SourceTextModuleRecord::ImportEntry *entry)
    {
        ASSERT(!entry->localName_.Empty());
        ASSERT(entry->importName_.Empty());
        ASSERT(entry->moduleRequestIdx_ != -1);
        namespaceImportEntries_.push_back(entry);
    }

    // export {x};
    // export {x as y};
    // export VariableStatement
    // export Declaration
    // export default ...
    bool SourceTextModuleRecord::AddLocalExportEntry(SourceTextModuleRecord::ExportEntry *entry)
    {
        ASSERT(entry->importName_.Empty());
        ASSERT(!entry->localName_.Empty());
        ASSERT(!entry->exportName_.Empty());
        ASSERT(entry->moduleRequestIdx_ == -1);

        // the implicit indirect exports should be insert into indirectExportsEntries
        // when add an ExportEntry.
        // e.g. import { x } from 'test.js'; export { x }
        if (ConvertLocalExportsToIndirect(entry)) {
            return true;
        }
        if (CheckDuplicateExports(entry->exportName_)) {
            localExportEntries_.insert(std::make_pair(entry->localName_, entry));
            return true;
        }
        return false;
    }

    // export {x} from 'test.js';
    // export {x as y} from 'test.js';
    // import { x } from 'test.js'; export { x };
    bool SourceTextModuleRecord::AddIndirectExportEntry(SourceTextModuleRecord::ExportEntry *entry)
    {
        ASSERT(!entry->importName_.Empty());
        ASSERT(!entry->exportName_.Empty());
        ASSERT(entry->localName_.Empty());
        ASSERT(entry->moduleRequestIdx_ != -1);
        if (CheckDuplicateExports(entry->exportName_)) {
            indirectExportEntries_.push_back(entry);
            return true;
        }
        return false;
    }

    // export * from 'test.js';
    void SourceTextModuleRecord::AddStarExportEntry(SourceTextModuleRecord::ExportEntry *entry)
    {
        ASSERT(entry->importName_.Empty());
        ASSERT(entry->localName_.Empty());
        ASSERT(entry->exportName_.Empty());
        ASSERT(entry->moduleRequestIdx_ != -1);
        starExportEntries_.push_back(entry);
    }

    bool SourceTextModuleRecord::CheckDuplicateExports(util::StringView exportName)
    {
        for (auto const &entryUnit : localExportEntries_) {
            const SourceTextModuleRecord::ExportEntry *e = entryUnit.second;
            if (exportName == e->exportName_) {
                return false;
            }
        }

        for (const auto *e : indirectExportEntries_) {
            if (exportName == e->exportName_) {
                return false;
            }
        }

        return true;
    }

    bool SourceTextModuleRecord::ConvertLocalExportsToIndirect(SourceTextModuleRecord::ExportEntry *exportEntry)
    {
        ASSERT(!exportEntry->localName_.Empty());
        auto importEntry = regularImportEntries_.find(exportEntry->localName_);
        if (importEntry != regularImportEntries_.end()) {
            ASSERT(exportEntry->importName_.Empty());
            ASSERT(exportEntry->moduleRequestIdx_ == -1);
            ASSERT(!importEntry->second->importName_.Empty());
            ASSERT(importEntry->second->moduleRequestIdx_ != -1);
            exportEntry->importName_ = importEntry->second->importName_;
            exportEntry->moduleRequestIdx_ = importEntry->second->moduleRequestIdx_;
            exportEntry->localName_ = util::StringView("");
            return AddIndirectExportEntry(exportEntry);
        }
        return false;
    }

    void SourceTextModuleRecord::ConvertLocalExportsToIndirect(SourceTextModuleRecord::ImportEntry *importEntry)
    {
        ASSERT(!importEntry->localName_.Empty());
        auto range = localExportEntries_.equal_range(importEntry->localName_);
        // not found implicit indirect
        if (range.first == range.second) {
            return;
        }

        for (auto it = range.first; it != range.second; ++it) {
            SourceTextModuleRecord::ExportEntry *exportEntry = it->second;
            ASSERT(exportEntry->importName_.Empty());
            ASSERT(exportEntry->moduleRequestIdx_ == -1);
            ASSERT(!importEntry->importName_.Empty());
            ASSERT(importEntry->moduleRequestIdx_ != -1);
            exportEntry->importName_ = importEntry->importName_;
            exportEntry->moduleRequestIdx_ = importEntry->moduleRequestIdx_;
            exportEntry->localName_ = util::StringView("");
            indirectExportEntries_.push_back(exportEntry);
        }
        localExportEntries_.erase(range.first, range.second);
    }
} // namespace panda::es2panda::parser
