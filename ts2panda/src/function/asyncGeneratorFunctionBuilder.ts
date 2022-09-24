/*
 * Copyright (c) 2022 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import ts from "typescript";
import { CacheList, getVregisterCache } from "../base/vregisterCache";
import { Compiler, ControlFlowChange } from "../compiler";
import {
    Label,
    VReg
} from "../irnodes";
import { PandaGen } from "../pandagen";
import { Recorder } from "../recorder";
import { NodeKind } from "../debuginfo";
import { CatchTable, LabelPair } from "../statement/tryStatement";

enum ResumeMode { Return = 0, Throw, Next };

/**
 * async function *foo() {
 *     yield 'a'
 * }
*/
export class AsyncGeneratorFunctionBuilder {
    private asyncPandaGen: PandaGen;
    private compiler: Compiler;
    private asyncGenObj: VReg;
    private retValue: VReg;
    private beginLabel: Label;
    private endLabel: Label;

    constructor(pandaGen: PandaGen, compiler: Compiler) {
        this.asyncPandaGen = pandaGen;
        this.compiler = compiler;
        this.beginLabel = new Label();
        this.endLabel = new Label();
        this.asyncGenObj = pandaGen.getTemp();
        this.retValue = pandaGen.getTemp();
    }

    prepare(node: ts.Node, recorder: Recorder) {
        let pandaGen = this.asyncPandaGen;

        // backend handle funcobj, frontend set undefined
        pandaGen.createAsyncGeneratorObj(node, getVregisterCache(pandaGen, CacheList.FUNC));
        pandaGen.storeAccumulator(node, this.asyncGenObj);
        pandaGen.loadAccumulator(node, getVregisterCache(pandaGen, CacheList.undefined));
        pandaGen.suspendGenerator(node, this.asyncGenObj);
        pandaGen.resumeGenerator(node, this.asyncGenObj);
        pandaGen.storeAccumulator(node, this.retValue);
    }

    await(node: ts.Node, value: VReg): void {
        let pandaGen = this.asyncPandaGen;
        let promise = this.asyncPandaGen.getTemp();

        pandaGen.loadAccumulator(node, value);
        pandaGen.asyncFunctionAwaitUncaught(node, this.asyncGenObj);

        pandaGen.suspendGenerator(node, this.asyncGenObj);

        pandaGen.freeTemps(promise);

        pandaGen.resumeGenerator(node, this.asyncGenObj);
        pandaGen.storeAccumulator(node, this.retValue);

        this.handleMode(node);
    }
	
    yield(node: ts.Node, value: VReg) {
        let pandaGen = this.asyncPandaGen;
        let promise = this.asyncPandaGen.getTemp();
        pandaGen.Asyncgeneratorresolve(node, this.asyncGenObj, value, getVregisterCache(pandaGen, CacheList.False));
        pandaGen.suspendGenerator(node, this.asyncGenObj);
        pandaGen.freeTemps(promise);
        pandaGen.resumeGenerator(node, this.asyncGenObj);
        pandaGen.storeAccumulator(node, this.retValue);
        this.asyncHandleMode(node, value);
    }

    private handleMode(node: ts.Node) {
        let pandaGen = this.asyncPandaGen;

        let modeType = pandaGen.getTemp();

        pandaGen.getResumeMode(node, this.asyncGenObj);
        pandaGen.storeAccumulator(node, modeType);

        // .return(value)
        pandaGen.loadAccumulatorInt(node, ResumeMode.Return);

        let notRetLabel = new Label();

        pandaGen.condition(node, ts.SyntaxKind.EqualsEqualsToken, modeType, notRetLabel);

        // if there are finally blocks, should implement these at first.
        this.compiler.compileFinallyBeforeCFC(
            undefined,
            ControlFlowChange.Break,
            undefined
        );

        pandaGen.loadAccumulator(node, this.retValue);
        pandaGen.return(node);

        // .throw(value)
        pandaGen.label(node, notRetLabel);

        pandaGen.loadAccumulatorInt(node, ResumeMode.Throw);

        let notThrowLabel = new Label();

        pandaGen.condition(node, ts.SyntaxKind.EqualsEqualsToken, modeType, notThrowLabel);
        pandaGen.loadAccumulator(node, this.retValue);
        pandaGen.throw(node);

        pandaGen.freeTemps(modeType);

        // .next(value)
        pandaGen.label(node, notThrowLabel);
        pandaGen.loadAccumulator(node, this.retValue);
    }

    private asyncHandleMode(node: ts.Node, value: VReg) {
        let pandaGen = this.asyncPandaGen;

        let modeType = pandaGen.getTemp();

        pandaGen.getResumeMode(node, this.asyncGenObj);
        pandaGen.storeAccumulator(node, modeType);

        // .next(value)
        pandaGen.loadAccumulatorInt(node, ResumeMode.Next);

        let notNextLabel = new Label();
        pandaGen.condition(node, ts.SyntaxKind.EqualsEqualsToken, modeType, notNextLabel);
        pandaGen.loadAccumulator(node, this.retValue);

        // .throw(value)
        pandaGen.label(node, notNextLabel);
        pandaGen.loadAccumulatorInt(node, ResumeMode.Throw);
        let notThrowLabel = new Label();
        pandaGen.condition(node, ts.SyntaxKind.EqualsEqualsToken, modeType, notThrowLabel);
        pandaGen.loadAccumulator(node, this.retValue);
        pandaGen.throw(node);

        pandaGen.freeTemps(modeType);

        // .return(value)
        pandaGen.label(node, notThrowLabel);
        pandaGen.loadAccumulator(node, this.retValue);
        pandaGen.return(node);
    }

    resolve(node: ts.Node | NodeKind, value: VReg) {
        let pandaGen = this.asyncPandaGen;
        pandaGen.Asyncgeneratorresolve(node, this.asyncGenObj, value, getVregisterCache(pandaGen, CacheList.True));
    }

    cleanUp(node: ts.Node) {
        let pandaGen = this.asyncPandaGen;
        pandaGen.label(node, this.endLabel);
        // catch
        pandaGen.asyncgeneratorreject(node, this.asyncGenObj); // exception is in acc
        pandaGen.return(NodeKind.Invalid);
        this.asyncPandaGen.freeTemps(this.asyncGenObj, this.retValue);
        new CatchTable(pandaGen, this.endLabel, new LabelPair(this.beginLabel, this.endLabel));
    }
}
