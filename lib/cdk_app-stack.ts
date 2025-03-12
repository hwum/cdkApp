import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';

export class CdkAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a CodeCommit repository
    const repository = new codecommit.Repository(this, 'MyRepository', {
      repositoryName: 'my-app-repository',
      description: 'Repository for my application',
    });

    // Create a Lambda function for condition checking
    const conditionCheckFunction = new lambda.Function(this, 'ConditionCheckFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          // Add your condition logic here
          // Return { result: true } to allow the stage to proceed
          // Return { result: false } to block the stage
          return { result: true };
        };
      `),
    });

    // Create a CloudWatch Alarm
    const metric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Errors',
      dimensionsMap: {
        FunctionName: conditionCheckFunction.functionName,
      },
      period: cdk.Duration.minutes(5),
      statistic: 'Sum',
    });

    const alarm = new cloudwatch.Alarm(this, 'ErrorAlarm', {
      metric,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    // Create artifacts
    const sourceOutput = new codepipeline.Artifact();

    // Create the pipeline
    const pipeline = new codepipeline.Pipeline(this, 'MyPipeline', {
      pipelineName: 'MyAppPipeline',
      stages: [
        {
          stageName: 'Source',
          actions: [
            new codepipeline_actions.CodeCommitSourceAction({
              actionName: 'CodeCommit_Source',
              repository: repository,
              output: sourceOutput,
              branch: 'main',
            }),
          ],
        },
        {
          stageName: 'Deploy',
          actions: [
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: 'Deploy',
              templatePath: sourceOutput.atPath('template.yaml'),
              stackName: 'MyApplicationStack',
              adminPermissions: true,
            }),
          ],
          // BeforeEntry condition - checks before entering the stage
          beforeEntry: {
            conditions: [{
              rules: [ new codepipeline.Rule({
                name: 'LambdaCheck',
                provider: 'LambdaInvoke',
                version: '1',
                configuration: {
                  FunctionName: conditionCheckFunction.functionName,
                },
              })],
              result:  codepipeline.Result.FAIL,
            }],
          },
          // OnSuccess condition - checks after successful stage completion
          onSuccess: {
            conditions: [{
              result: codepipeline.Result.FAIL,
              rules: [new codepipeline.Rule({
                name: 'CloudWatchCheck',
                provider: 'LambdaInvoke',
                version: '1',
                configuration: {
                  AlarmName: alarm.alarmName,
                  WaitTime: '300', // 5 minutes
                  FunctionName: 'funcName2'
                },
              })],
            }],
          },
          // OnFailure condition - handles stage failure
          onFailure: {
            conditions: [{
              result: codepipeline.Result.ROLLBACK,
               rules: [new codepipeline.Rule({
                name: 'RollBackOnFailure',
                provider: 'LambdaInvoke',
                version: '1',
                configuration: {
                  AlarmName: alarm.alarmName,
                  WaitTime: '300', // 5 minutes
                  FunctionName: 'funcName1'
                },
              })],
            }],
          },
        },
      ],
    });
  }
}

// lambda/condition-check/index.ts
export async function handler(event: any) {
  try {
    // Implement your condition checking logic here
    // For example:
    // - Check if it's within deployment window
    // - Verify environment health
    // - Check security compliance

    const isConditionMet = true; // Your actual condition check

    return {
      result: isConditionMet,
      message: isConditionMet ? 'Condition check passed' : 'Condition check failed'
    };
  } catch (error) {
    console.error('Error in condition check:', error);
    throw error;
  }
}
